import type { ChunkSynthesis, DialogueLine, DialogueResolution } from './types';

function isKnownSpeaker(value: string | undefined): boolean {
  const speaker = String(value || '').trim();
  return Boolean(speaker) && !/^(未知|未确认|不确定)$/u.test(speaker);
}

export function buildDialogueResolutionKey(pageNumber: number, lineIndex: number): string {
  return `${pageNumber}:${lineIndex}`;
}

export function createDialogueResolutionMap(
  chunkSyntheses: Array<Pick<ChunkSynthesis, 'dialogueResolutions'>>
): Map<string, DialogueResolution> {
  const resolutionMap = new Map<string, DialogueResolution>();

  for (const chunk of chunkSyntheses) {
    for (const resolution of chunk.dialogueResolutions || []) {
      if (
        !Number.isFinite(resolution.pageNumber)
        || !Number.isFinite(resolution.lineIndex)
        || resolution.pageNumber <= 0
        || resolution.lineIndex <= 0
        || !isKnownSpeaker(resolution.speaker)
      ) {
        continue;
      }

      resolutionMap.set(
        buildDialogueResolutionKey(resolution.pageNumber, resolution.lineIndex),
        resolution
      );
    }
  }

  return resolutionMap;
}

export function applyDialogueResolutionMap(
  pageNumber: number,
  dialogue: DialogueLine[],
  resolutionMap: Map<string, DialogueResolution>
): DialogueLine[] {
  return dialogue.map((line, index) => {
    const resolution = resolutionMap.get(buildDialogueResolutionKey(pageNumber, index + 1));
    if (!resolution) {
      return { ...line };
    }

    return {
      ...line,
      speaker: resolution.speaker,
      speakerEvidence: resolution.speakerEvidence || line.speakerEvidence,
      speakerConfidence: resolution.speakerConfidence || line.speakerConfidence,
    };
  });
}
