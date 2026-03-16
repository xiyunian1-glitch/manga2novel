import type { ImageChunk, ImageItem, TaskState } from './types';

const DB_NAME = 'manga2novel_workspace';
const DB_VERSION = 1;
const STORE_NAME = 'snapshots';
const IMAGE_FILES_KEY = 'image_files';
const IMAGE_META_KEY = 'image_meta';
const TASK_STATE_KEY = 'task_state';

interface PersistedImageFile {
  id: string;
  file: File;
}

export interface PersistedImageItem {
  id: string;
  processedBase64?: string;
  processedMime?: string;
  status: ImageItem['status'];
  originalSize: number;
  compressedSize?: number;
}

export interface RestorableImageItem extends PersistedImageItem {
  file: File;
}

export interface PersistedImageChunk extends Omit<ImageChunk, 'images'> {
  imageIds: string[];
}

export interface PersistedTaskState extends Omit<TaskState, 'chunks'> {
  chunks: PersistedImageChunk[];
}

export interface WorkspaceSnapshot {
  images: RestorableImageItem[];
  taskState: PersistedTaskState | null;
}

function supportsIndexedDb(): boolean {
  return typeof window !== 'undefined' && typeof window.indexedDB !== 'undefined';
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (!supportsIndexedDb()) {
      reject(new Error('IndexedDB is not available in this browser.'));
      return;
    }

    const request = window.indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME);
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Failed to open IndexedDB.'));
  });
}

function withStore<T>(
  mode: IDBTransactionMode,
  handler: (store: IDBObjectStore) => Promise<T>
): Promise<T> {
  return openDatabase().then((database) => new Promise<T>((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, mode);
    const store = transaction.objectStore(STORE_NAME);
    let transactionResult: T;
    let transactionResolved = false;

    transaction.oncomplete = () => {
      if (transactionResolved) {
        return;
      }
      transactionResolved = true;
      database.close();
      resolve(transactionResult);
    };

    transaction.onerror = () => {
      if (transactionResolved) {
        return;
      }
      transactionResolved = true;
      database.close();
      reject(transaction.error || new Error('IndexedDB transaction failed.'));
    };

    handler(store)
      .then((result) => {
        transactionResult = result;
      })
      .catch((error) => {
        if (transactionResolved) {
          return;
        }
        transactionResolved = true;
        database.close();
        reject(error);
        transaction.abort();
      });
  }));
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('IndexedDB request failed.'));
  });
}

export function serializeImages(images: ImageItem[]): PersistedImageItem[] {
  return images.map((image) => ({
    id: image.id,
    processedBase64: image.processedBase64,
    processedMime: image.processedMime,
    status: image.status,
    originalSize: image.originalSize,
    compressedSize: image.compressedSize,
  }));
}

export function serializeTaskState(taskState: TaskState): PersistedTaskState {
  return {
    ...taskState,
    chunks: taskState.chunks.map((chunk) => ({
      ...chunk,
      imageIds: chunk.images.map((image) => image.id),
    })),
  };
}

export async function saveWorkspaceImageFiles(images: ImageItem[]): Promise<void> {
  if (!supportsIndexedDb()) {
    return;
  }

  const files: PersistedImageFile[] = images.map((image) => ({
    id: image.id,
    file: image.file,
  }));

  await withStore('readwrite', (store) => requestToPromise(store.put(files, IMAGE_FILES_KEY)).then(() => undefined));
}

export async function saveWorkspaceImageMeta(images: PersistedImageItem[]): Promise<void> {
  if (!supportsIndexedDb()) {
    return;
  }

  await withStore('readwrite', (store) => requestToPromise(store.put(images, IMAGE_META_KEY)).then(() => undefined));
}

export async function saveWorkspaceTaskState(taskState: PersistedTaskState | null): Promise<void> {
  if (!supportsIndexedDb()) {
    return;
  }

  await withStore('readwrite', async (store) => {
    if (taskState === null) {
      await requestToPromise(store.delete(TASK_STATE_KEY));
      return;
    }

    await requestToPromise(store.put(taskState, TASK_STATE_KEY));
  });
}

export async function loadWorkspaceSnapshot(): Promise<WorkspaceSnapshot | null> {
  if (!supportsIndexedDb()) {
    return null;
  }

  return withStore('readonly', async (store) => {
    const imageFileRequest = store.get(IMAGE_FILES_KEY);
    const imageMetaRequest = store.get(IMAGE_META_KEY);
    const taskStateRequest = store.get(TASK_STATE_KEY);

    const [imageFiles, imageMeta, taskState] = await Promise.all([
      requestToPromise(imageFileRequest) as Promise<PersistedImageFile[] | undefined>,
      requestToPromise(imageMetaRequest) as Promise<PersistedImageItem[] | undefined>,
      requestToPromise(taskStateRequest) as Promise<PersistedTaskState | undefined>,
    ]);

    const imageFilesById = new Map((imageFiles || []).map((item) => [item.id, item.file]));
    const images = (imageMeta || []).map((item) => ({
      ...item,
      file: imageFilesById.get(item.id),
    })).filter((item): item is PersistedImageItem & { file: File } => item.file instanceof File);

    if (images.length === 0 && !taskState) {
      return null;
    }

    return {
      images,
      taskState: taskState || null,
    };
  });
}

export async function clearWorkspaceSnapshot(): Promise<void> {
  if (!supportsIndexedDb()) {
    return;
  }

  await withStore('readwrite', async (store) => {
    await Promise.all([
      requestToPromise(store.delete(IMAGE_FILES_KEY)),
      requestToPromise(store.delete(IMAGE_META_KEY)),
      requestToPromise(store.delete(TASK_STATE_KEY)),
    ]);
  });
}
