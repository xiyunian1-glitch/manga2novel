import type {
  ChunkSynthesis,
  CreativePreset,
  PageAnalysis,
  ScenePlan,
  StorySynthesis,
} from './types';

export const CUSTOM_PRESET_ID = 'custom';
export const SPECIAL_PROMPT_HEADING = '## 特殊提示词';
const LEGACY_SUPPLEMENTAL_PROMPT_HEADING = '## 补充提示';
export const ROLE_AND_STYLE_HEADING = '## 创作风格';
export const SYSTEM_PROMPT_HEADING = '## 系统提示词';
export const USER_PROMPT_TEMPLATE_VARIABLES = [
  '{{chunkHeader}}',
  '{{summaryBlock}}',
  '{{endingBlock}}',
  '{{continuationBlock}}',
  '{{outputInstruction}}',
] as const;

const OUTPUT_SCHEMA = `## 输出格式（严格JSON）
你必须以如下 JSON 格式回复，不要添加任何 Markdown 代码块标记：
{
  "novelText": "本组图片对应的小说内容（完整的叙事段落，不要省略）",
  "plotSummary": "到目前为止的全局剧情摘要（包含所有重要角色、事件、关系，200字以内）",
  "endingDetail": "本组最后的场景细节和角色状态（用于衔接下一组，100字以内）"
}`;

const LEGACY_SYSTEM_PROMPT_BODY = `## 你的任务
分析提供的漫画图片，将其转化为流畅、生动、结构清晰的小说段落。

## 输出规则
1. 叙事必须承接前文，确保人物动机、关系与事件线一致
2. 将动作、表情、场景、镜头语言转写成文学描写，而不是简单罗列画面
3. 对话统一使用「」包裹，并保留角色个性与语气差异
4. 保留节奏感，关键场面适度放大，过场不要冗长
5. 注意环境、光线、气味、声音、触感等细节，增强临场感
6. 不要解释你在做什么，也不要输出额外注释

${OUTPUT_SCHEMA}`;

export const SYSTEM_PROMPT_BODY = `## 你的任务
基于提供的漫画图片，只根据清晰可见的画面信息进行理解，并将其改写为连贯、耐读的中文小说段落。

## 输出规则
1. 叙事必须承接前文，确保人物动机、关系与事件线一致
2. 将动作、表情、场景、镜头语言转写成文学描写，而不是简单罗列画面
3. 对话统一使用「」包裹，并保留角色个性与语气差异
4. 保留节奏感，关键场面适度放大，过场不要冗长
5. 注意环境、光线、气味、声音、触感等细节，增强临场感
6. 遇到裸露、性暗示、亲密接触或其他敏感画面时，只保留剧情推进必需的信息，用含蓄、非露骨的方式表达，不要输出详细性描写
7. 看不清、被遮挡或无法确认的细节不要臆测，可使用模糊表述或直接略过
8. 不要解释你在做什么，也不要输出额外注释

${OUTPUT_SCHEMA}`;

export const USER_PROMPT_TEMPLATE = `{{chunkHeader}}

{{summaryBlock}}

{{endingBlock}}

{{continuationBlock}}

{{outputInstruction}}`;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function findHeadingIndex(text: string, headings: string[]): { heading: string; index: number } | null {
  const matches = headings
    .map((heading) => {
      const match = new RegExp(`(^|\\n)${escapeRegExp(heading)}(?=\\n|$)`).exec(text);
      if (!match) {
        return null;
      }

      return {
        heading,
        index: match.index + match[1].length,
      };
    })
    .filter((match): match is { heading: string; index: number } => match !== null);

  if (matches.length === 0) {
    return null;
  }

  return matches.reduce((earliest, current) => (
    current.index < earliest.index ? current : earliest
  ));
}

export function composeSystemPrompt(
  supplementalPrompt: string,
  roleAndStyle: string,
  systemPromptBody = SYSTEM_PROMPT_BODY
): string {
  const trimmedSupplementalPrompt = supplementalPrompt.trim();
  const trimmedRoleAndStyle = roleAndStyle.trim();
  const trimmedSystemPromptBody = systemPromptBody.trim();
  const sections: string[] = [];

  if (trimmedSupplementalPrompt) {
    sections.push(`${SPECIAL_PROMPT_HEADING}\n${trimmedSupplementalPrompt}`);
  }

  if (trimmedRoleAndStyle) {
    sections.push(`${ROLE_AND_STYLE_HEADING}\n${trimmedRoleAndStyle}`);
  }

  if (trimmedSystemPromptBody) {
    sections.push(`${SYSTEM_PROMPT_HEADING}\n${trimmedSystemPromptBody}`);
  }

  return sections.join('\n\n').trim();
}

export function splitSystemPrompt(systemPrompt: string): {
  supplementalPrompt: string;
  roleAndStyle: string;
  systemPromptBody: string;
} {
  const normalizedPrompt = systemPrompt.trim();
  const explicitSystemSection = findHeadingIndex(normalizedPrompt, [SYSTEM_PROMPT_HEADING]);
  const legacySystemSection = explicitSystemSection
    ? null
    : findHeadingIndex(normalizedPrompt, ['## 你的任务', '## 输出规则']);
  const systemSection = explicitSystemSection || legacySystemSection;

  const promptPrefix = systemSection === null
    ? normalizedPrompt
    : normalizedPrompt.slice(0, systemSection.index).trim();
  const rawSystemPromptBody = systemSection === null
    ? SYSTEM_PROMPT_BODY
    : normalizedPrompt.slice(systemSection.index + systemSection.heading.length).trim();
  const systemPromptBody = rawSystemPromptBody === LEGACY_SYSTEM_PROMPT_BODY
    ? SYSTEM_PROMPT_BODY
    : rawSystemPromptBody;

  const supplementalPattern = [
    SPECIAL_PROMPT_HEADING,
    LEGACY_SUPPLEMENTAL_PROMPT_HEADING,
  ].map(escapeRegExp).join('|');
  const roleAndStyleHeadingPattern = escapeRegExp(ROLE_AND_STYLE_HEADING);

  const supplementalMatch = promptPrefix.match(
    new RegExp(`(?:^|\\n)(?:${supplementalPattern})\\s*([\\s\\S]*?)(?=\\n${roleAndStyleHeadingPattern}|$)`)
  );
  const roleAndStyleMatch = promptPrefix.match(
    new RegExp(`(?:^|\\n)${roleAndStyleHeadingPattern}\\s*([\\s\\S]*?)$`)
  );

  if (supplementalMatch || roleAndStyleMatch) {
    return {
      supplementalPrompt: supplementalMatch?.[1]?.trim() || '',
      roleAndStyle: roleAndStyleMatch?.[1]?.trim() || '',
      systemPromptBody,
    };
  }

  return {
    supplementalPrompt: '',
    roleAndStyle: promptPrefix,
    systemPromptBody,
  };
}

function buildSystemPrompt(roleAndStyle: string): string {
  return composeSystemPrompt('', roleAndStyle, SYSTEM_PROMPT_BODY);
}

const DEFAULT_MANGA_NOVELIST_PROMPT = buildSystemPrompt('你是一位专业的漫改小说家，擅长把分镜、情绪推进和人物关系转写成连贯、耐读的中文小说。整体风格成熟、克制、画面感强。');

export const CREATIVE_PRESETS: CreativePreset[] = [
  {
    id: CUSTOM_PRESET_ID,
    name: '自定义',
    prompt: '',
  },
  {
    id: 'professional-manga-novelist',
    name: '专业漫改小说家',
    prompt: DEFAULT_MANGA_NOVELIST_PROMPT,
  },
  {
    id: 'light-novel',
    name: '日式轻小说',
    prompt: buildSystemPrompt('你是一位擅长日式轻小说叙事的作者，文风轻快、角色感鲜明、内心独白细腻，适合青春、冒险、恋爱与群像剧情。'),
  },
  {
    id: 'hard-sci-fi',
    name: '硬核科幻',
    prompt: buildSystemPrompt('你是一位硬核科幻作家，重视设定自洽、科技细节、社会结构与危机推进。语言冷静、准确，但仍保持戏剧张力。'),
  },
  {
    id: 'xianxia',
    name: '武侠修仙',
    prompt: buildSystemPrompt('你是一位擅长武侠修仙叙事的作者，语言有古意但不晦涩，重视招式、气机、门派秩序与心境变化。'),
  },
  {
    id: 'cthulhu',
    name: '克苏鲁感官',
    prompt: buildSystemPrompt('你是一位擅长克苏鲁与诡异感官描写的作者，强调未知、失真、恐惧与不可靠感知，但依然保持叙事清晰。'),
  },
  {
    id: 'adult-literary',
    name: '成熟情感文学',
    prompt: buildSystemPrompt('你是一位擅长成熟情感文学的作者，强调复杂情感、关系张力与人物心理。表达成熟、克制、文学化；亲密场景只做含蓄留白，不写露骨细节。'),
  },
];

export const SYSTEM_PROMPT = DEFAULT_MANGA_NOVELIST_PROMPT;

export function getCreativePreset(presetId: string): CreativePreset | undefined {
  return CREATIVE_PRESETS.find((preset) => preset.id === presetId);
}

export function resolveCreativePresetId(systemPrompt: string): string {
  const { roleAndStyle } = splitSystemPrompt(systemPrompt);
  const matchedPreset = CREATIVE_PRESETS.find(
    (preset) => preset.id !== CUSTOM_PRESET_ID && splitSystemPrompt(preset.prompt).roleAndStyle === roleAndStyle
  );
  return matchedPreset?.id || CUSTOM_PRESET_ID;
}

/**
 * 构建第 N 轮请求的用户提示词
 */
export function buildUserPrompt(
  chunkIndex: number,
  globalSummary: string,
  previousEnding: string,
  template = USER_PROMPT_TEMPLATE
): string {
  const runtimeTemplate = template.trim() || USER_PROMPT_TEMPLATE;
  const variables: Record<string, string> = {
    chunkHeader: chunkIndex === 0
      ? '这是漫画的开始。请分析以下图片，开始创作小说的开头。'
      : `这是第 ${chunkIndex + 1} 组漫画图片。`,
    summaryBlock: globalSummary ? `【前文剧情摘要】\n${globalSummary}` : '',
    endingBlock: previousEnding ? `【前一组结尾】\n${previousEnding}` : '',
    continuationBlock: chunkIndex === 0 ? '' : '请延续前文，继续创作。确保新内容与前文衔接自然。',
    outputInstruction: '请分析以下图片并严格按照 JSON 格式输出。',
  };

  let renderedPrompt = runtimeTemplate;
  for (const [key, value] of Object.entries(variables)) {
    renderedPrompt = renderedPrompt.split(`{{${key}}}`).join(value);
  }

  return renderedPrompt
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

const PAGE_ANALYSIS_ITEM_OUTPUT_SCHEMA = `{
  "summary": "本页剧情摘要",
  "location": "场景地点，不确定可写未知",
  "timeHint": "时间线索，不确定可写未知",
  "keyEvents": ["关键事件1", "关键事件2"],
  "dialogue": [
    {
      "speaker": "说话人，不确定请写未确认",
      "text": "该页单个气泡或单条明确分开的对白原文，尽量保留原句",
      "speakerEvidence": "支撑说话人归属的可见证据；如果不确定可写证据不足",
      "speakerConfidence": "high"
    }
  ],
  "narrationText": ["该页旁白、说明文字或内心独白原文"],
  "visualText": ["该页标题、字幕、拟声词、界面文字等可见文本原文"],
  "characters": [
    {
      "name": "角色名，不确定可写未知角色",
      "role": "角色作用",
      "traits": ["可见特征或状态"],
      "relationshipHints": ["和其他角色的关系线索"],
      "evidence": ["支持上述判断的画面证据"]
    }
  ]
}`;

const PAGE_ANALYSIS_OUTPUT_SCHEMA = `{
  "pages": [
    {
      "pageNumber": 1,
      "summary": "本页剧情摘要",
      "location": "场景地点，不确定可写未知",
      "timeHint": "时间线索，不确定可写未知",
      "keyEvents": ["关键事件1", "关键事件2"],
      "dialogue": [
        {
          "speaker": "说话人，不确定请写未确认",
          "text": "该页单个气泡或单条明确分开的对白原文，尽量保留原句",
          "speakerEvidence": "支撑说话人归属的可见证据；如果不确定可写证据不足",
          "speakerConfidence": "high"
        }
      ],
      "narrationText": ["该页旁白、说明文字或内心独白原文"],
      "visualText": ["该页标题、字幕、拟声词、界面文字等可见文本原文"],
      "characters": [
        {
          "name": "角色名，不确定可写未知角色",
          "role": "角色作用",
          "traits": ["可见特征或状态"],
          "relationshipHints": ["和其他角色的关系线索"],
          "evidence": ["支持上述判断的画面证据"]
        }
      ]
    }
  ]
}`;

const PAGE_ANALYSIS_DIALOGUE_RULES = `对白归属补充规则：
1. dialogue 中的每一项只对应一个气泡，或一条明确分开的发言，不要把多个角色的话合并到同一项。
2. 只有当同一页画面里存在明确可见证据时，才填写 dialogue.speaker，例如：气泡尾巴明确指向角色、人物名字直接标注在对白旁、同格内只有一个明确正在发言的人物。
3. 不能因为剧情常识、前后页上下文、上一句或下一句对白，就推断当前气泡一定属于某个角色。
4. 只要说话人存在多个候选、被遮挡、离画、证据模糊，或你只有猜测，没有直接证据，就把 speaker 写成“未确认”。
5. speakerEvidence 请简短写出你判定说话人的依据；如果没有可靠依据，请写“证据不足”。
6. speakerConfidence 只能填写 high / medium / low。
7. 只要不够确定，就优先把 speaker 写成“未确认”，并把 speakerConfidence 设为 low，而不是猜一个角色名。`;

const CHUNK_SYNTHESIS_OUTPUT_SCHEMA = `{
  "title": "本块标题",
  "summary": "本块剧情摘要",
  "keyDevelopments": ["本块的重要推进"],
  "continuitySummary": "下一块写作需要承接的状态"
}`;

const GLOBAL_SYNTHESIS_OUTPUT_SCHEMA = `{
  "storyOverview": "完整故事概览",
  "worldGuide": "世界观与环境说明",
  "characterGuide": "主要人物关系与动机总结",
  "sceneOutline": [
    {
      "sceneId": "scene-1",
      "title": "场景标题",
      "summary": "场景摘要",
      "chunkIndexes": [0]
    }
  ],
  "writingConstraints": ["写作约束 1", "写作约束 2"]
}`;

const SECTION_OUTPUT_SCHEMA = `{
  "novelText": "本节小说正文",
  "continuitySummary": "本节结束时的承接摘要"
}`;

const SECTION_SYSTEM_PROMPT_BODY = `## 你的任务
你会收到已经整理好的漫画场景资料，而不是原始图片。
请只根据这些结构化资料创作连贯、耐读的中文小说正文。

## 输出规则
1. 必须忠于提供的资料，不要擅自新增关键事件、角色设定或世界规则。
2. 允许把资料中的动作、情绪、停顿与因果整理成自然叙事。
3. 保持人物语气、关系、动机和场景顺序一致。
4. 如果资料里存在模糊信息，可以模糊表达，但不要擅自补全。
5. 不要提到“漫画、分镜、画格、镜头、气泡”等元信息。
6. 如遇敏感画面，只保留剧情推进所必需的信息，避免露骨描写。
7. 只返回 JSON，不要附加 Markdown 代码块或额外说明。
${SECTION_OUTPUT_SCHEMA}`;

function stringifyPromptData(data: unknown): string {
  return JSON.stringify(data, null, 2);
}

function dedupeStrings(values: Array<string | undefined>, limit = 6): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const value of values) {
    const normalized = String(value || '').trim();
    if (!normalized) {
      continue;
    }

    const key = normalized.toLowerCase();
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    result.push(normalized);
    if (result.length >= limit) {
      break;
    }
  }

  return result;
}

function summarizeCharacterContext(pageAnalyses: PageAnalysis[], limit = 10) {
  const characterMap = new Map<string, {
    name: string;
    roles: string[];
    traits: string[];
    relationshipHints: string[];
    pageNumbers: number[];
    chunkIndexes: number[];
  }>();

  for (const page of pageAnalyses) {
    for (const character of page.characters) {
      const name = character.name.trim() || 'Unknown character';
      const key = name.toLowerCase();
      const existing = characterMap.get(key) || {
        name,
        roles: [],
        traits: [],
        relationshipHints: [],
        pageNumbers: [],
        chunkIndexes: [],
      };

      existing.roles = dedupeStrings([...existing.roles, character.role], 4);
      existing.traits = dedupeStrings([...existing.traits, ...character.traits], 6);
      existing.relationshipHints = dedupeStrings(
        [...existing.relationshipHints, ...character.relationshipHints],
        6
      );
      existing.pageNumbers = Array.from(new Set([...existing.pageNumbers, page.pageNumber])).sort((left, right) => left - right);
      existing.chunkIndexes = Array.from(new Set([...existing.chunkIndexes, page.chunkIndex])).sort((left, right) => left - right);

      characterMap.set(key, existing);
    }
  }

  return Array.from(characterMap.values())
    .sort((left, right) => (
      right.pageNumbers.length - left.pageNumbers.length
      || left.name.localeCompare(right.name, 'zh-Hans-CN')
    ))
    .slice(0, limit);
}

function buildBoundaryPagePreview(pageAnalyses: PageAnalysis[], mode: 'start' | 'end') {
  const selectedPages = mode === 'start'
    ? pageAnalyses.slice(0, 2)
    : pageAnalyses.slice(Math.max(0, pageAnalyses.length - 2));

  return selectedPages.map((page) => ({
    pageNumber: page.pageNumber,
    summary: page.summary,
    location: page.location,
    timeHint: page.timeHint,
    keyEvents: page.keyEvents.slice(0, 4),
    characters: dedupeStrings(page.characters.map((character) => character.name), 5),
  }));
}

function buildLocationTimeline(pageAnalyses: PageAnalysis[]) {
  const chunkMap = new Map<number, {
    chunkIndex: number;
    pageRange: [number, number];
    locations: string[];
    timeHints: string[];
  }>();

  for (const page of pageAnalyses) {
    const existing = chunkMap.get(page.chunkIndex) || {
      chunkIndex: page.chunkIndex,
      pageRange: [page.pageNumber, page.pageNumber] as [number, number],
      locations: [],
      timeHints: [],
    };

    existing.pageRange = [
      Math.min(existing.pageRange[0], page.pageNumber),
      Math.max(existing.pageRange[1], page.pageNumber),
    ];
    existing.locations = dedupeStrings([...existing.locations, page.location], 5);
    existing.timeHints = dedupeStrings([...existing.timeHints, page.timeHint], 5);
    chunkMap.set(page.chunkIndex, existing);
  }

  return Array.from(chunkMap.values())
    .sort((left, right) => left.chunkIndex - right.chunkIndex);
}

function buildChunkContinuityChain(chunkSyntheses: ChunkSynthesis[]) {
  return chunkSyntheses.map((chunk) => ({
    index: chunk.index,
    title: chunk.title,
    summary: chunk.summary,
    keyDevelopments: chunk.keyDevelopments.slice(0, 5),
    continuitySummary: chunk.continuitySummary,
  }));
}

export function buildSectionSystemPrompt(systemPrompt: string): string {
  const { supplementalPrompt, roleAndStyle } = splitSystemPrompt(systemPrompt);
  return composeSystemPrompt(supplementalPrompt, roleAndStyle, SECTION_SYSTEM_PROMPT_BODY);
}

export function buildPageAnalysisPrompt(
  chunkIndex: number,
  pages: Array<Pick<PageAnalysis, 'pageNumber' | 'imageName'>>,
  totalPages: number
): string {
  const firstPageNumber = pages[0]?.pageNumber ?? 1;
  const lastPageNumber = pages[pages.length - 1]?.pageNumber ?? firstPageNumber;
  const pageList = pages.map((page) => ({
    pageNumber: page.pageNumber,
    imageName: page.imageName,
  }));

  return `你正在分析整部漫画的第 ${chunkIndex + 1} 块，共 ${pages.length} 页，覆盖第 ${firstPageNumber}-${lastPageNumber} / ${totalPages} 页。

你将收到按顺序排列的多张图片。请为每一页分别输出一条分析结果。
要求：
1. 只根据对应那一页图片中清晰可见的信息进行总结，不要跨页合并。
2. pages 数组长度必须与输入图片数量完全一致。
3. pages 数组顺序必须与输入图片顺序完全一致。
4. pageNumber 必须与下面给出的页码一致。
5. 如果该页存在对白、旁白、内心独白、拟声词、标题、字幕、UI 文字或其他可识别文本，必须提取到 dialogue / narrationText / visualText。
6. dialogue.text、narrationText、visualText 尽量保留原文，不要改写成摘要，不要补写不存在的字句。
7. dialogue.speaker 如果无法确认，统一写“未确认”；如果该页没有对白，返回空数组。
8. 看不清、被遮挡或没有证据的文字不要猜测，直接留空数组或用“未确认”。

待分析页码：
${stringifyPromptData(pageList)}

${PAGE_ANALYSIS_DIALOGUE_RULES}

单页字段说明：
${PAGE_ANALYSIS_ITEM_OUTPUT_SCHEMA}

严格按以下 JSON 输出：
${PAGE_ANALYSIS_OUTPUT_SCHEMA}`;
}

export function buildChunkSynthesisPrompt(chunkIndex: number, pageAnalyses: PageAnalysis[]): string {
  return `下面是第 ${chunkIndex + 1} 块图片对应的逐页分析结果。
请把这些逐页分析整合成一个更稳定的块级剧情摘要，重点提炼本块的情节推进和承接点。

逐页分析数据：
${stringifyPromptData(pageAnalyses)}

严格按以下 JSON 输出：
${CHUNK_SYNTHESIS_OUTPUT_SCHEMA}`;
}

export function buildGlobalSynthesisPrompt(chunkSyntheses: ChunkSynthesis[]): string {
  return `下面是整部漫画的块级综合结果。
请在全书层面整合故事概览、人物关系、世界信息、场景大纲和写作约束。

块级综合数据：
${stringifyPromptData(chunkSyntheses)}

要求：
1. sceneOutline 的 chunkIndexes 必须引用已有块编号。
2. 如果难以准确拆场景，允许一个场景只包含一个块。
3. writingConstraints 只保留真正会影响写作的一致性约束。

严格按以下 JSON 输出：
${GLOBAL_SYNTHESIS_OUTPUT_SCHEMA}`;
}

export function buildContextualChunkSynthesisPrompt(
  chunkIndex: number,
  pageAnalyses: PageAnalysis[],
  context?: {
    previousChunk?: Pick<ChunkSynthesis, 'index' | 'title' | 'summary' | 'continuitySummary'> | null;
    previousPages?: PageAnalysis[];
    nextPages?: PageAnalysis[];
  }
): string {
  const continuityContext = {
    previousChunk: context?.previousChunk
      ? {
          index: context.previousChunk.index,
          title: context.previousChunk.title,
          summary: context.previousChunk.summary,
          continuitySummary: context.previousChunk.continuitySummary,
          endingPreview: buildBoundaryPagePreview(context.previousPages || [], 'end'),
        }
      : null,
    currentChunkCharacters: summarizeCharacterContext(pageAnalyses, 8),
    nextChunkPreview: (context?.nextPages?.length ?? 0) > 0
      ? {
          openingPages: buildBoundaryPagePreview(context?.nextPages || [], 'start'),
          likelyCarryOverCharacters: summarizeCharacterContext(context?.nextPages || [], 6).map((character) => character.name),
        }
      : null,
  };

  return `Below is the page-level analysis for chunk ${chunkIndex + 1}. Please synthesize only the current chunk into a stable chunk-level summary, but use the continuity context to make transitions cleaner and character state changes more coherent.

Current chunk page analyses:
${stringifyPromptData(pageAnalyses)}

Continuity context for adjacent chunks (use only for coherence; do not merge adjacent-chunk events into the current-chunk summary):
${stringifyPromptData(continuityContext)}

Requirements:
1. title, summary, and keyDevelopments must be grounded in the current chunk pages only.
2. continuitySummary should emphasize what the next chunk must inherit: ending situation, unresolved tension, relationship shifts, location/time cues, and emotional state.
3. If adjacent-chunk context conflicts with the current chunk pages, trust the current chunk pages first.
4. Character names, roles, and relationships should stay consistent with the continuity context whenever the current chunk supports them.

Strictly output JSON:
${CHUNK_SYNTHESIS_OUTPUT_SCHEMA}`;
}

export function buildContextualGlobalSynthesisPrompt(
  chunkSyntheses: ChunkSynthesis[],
  pageAnalyses: PageAnalysis[]
): string {
  const globalContext = {
    continuityChain: buildChunkContinuityChain(chunkSyntheses),
    recurringCharacters: summarizeCharacterContext(pageAnalyses, 12),
    locationTimeline: buildLocationTimeline(pageAnalyses),
  };

  return `Below are the chunk-level synthesis results for the whole manga. Please build a coherent story-level synthesis that preserves cross-chunk continuity, recurring character relationships, and scene transitions.

Chunk synthesis data:
${stringifyPromptData(chunkSyntheses)}

Global continuity context:
${stringifyPromptData(globalContext)}

Requirements:
1. storyOverview, characterGuide, and sceneOutline should primarily reflect the chunk synthesis data, while the continuity context is used to keep names, motives, relationships, and transitions consistent.
2. characterGuide should merge recurring roles, relationship hints, and cross-chunk changes for the same characters.
3. sceneOutline should respect chunk order and continuity summaries, especially at boundaries between adjacent chunks.
4. sceneOutline.chunkIndexes must reference existing chunk indexes only.
5. writingConstraints should keep only the constraints that materially affect later writing consistency.

Strictly output JSON:
${GLOBAL_SYNTHESIS_OUTPUT_SCHEMA}`;
}

export function buildSectionUserPrompt(
  sectionIndex: number,
  storySynthesis: StorySynthesis,
  previousContinuity: string,
  scenePlan: ScenePlan,
  chunkSyntheses: ChunkSynthesis[],
  pageAnalyses: PageAnalysis[],
  template = USER_PROMPT_TEMPLATE
): string {
  const runtimeTemplate = template.trim() || USER_PROMPT_TEMPLATE;
  const relatedChunkIndexes = new Set(scenePlan.chunkIndexes);
  const relatedPageAnalyses = pageAnalyses
    .filter((page) => relatedChunkIndexes.has(page.chunkIndex));
  const relatedChunks = chunkSyntheses
    .filter((chunk) => relatedChunkIndexes.has(chunk.index))
    .map((chunk) => ({
      index: chunk.index,
      title: chunk.title,
      summary: chunk.summary,
      keyDevelopments: chunk.keyDevelopments,
      continuitySummary: chunk.continuitySummary,
    }));
  const relatedPages = relatedPageAnalyses
    .map((page) => ({
      pageNumber: page.pageNumber,
      summary: page.summary,
      location: page.location,
      timeHint: page.timeHint,
      keyEvents: page.keyEvents,
      dialogue: page.dialogue,
      narrationText: page.narrationText,
      visualText: page.visualText,
      characters: page.characters.map((character) => ({
        name: character.name,
        role: character.role,
        traits: character.traits,
        relationshipHints: character.relationshipHints,
      })),
    }));
  const previousScene = storySynthesis.sceneOutline[sectionIndex - 1];
  const nextScene = storySynthesis.sceneOutline[sectionIndex + 1];
  const previousScenePages = previousScene
    ? pageAnalyses.filter((page) => previousScene.chunkIndexes.includes(page.chunkIndex))
    : [];
  const nextScenePages = nextScene
    ? pageAnalyses.filter((page) => nextScene.chunkIndexes.includes(page.chunkIndex))
    : [];
  const currentSceneCharacters = summarizeCharacterContext(relatedPageAnalyses, 10);
  const sceneWindow = storySynthesis.sceneOutline
    .slice(Math.max(0, sectionIndex - 1), sectionIndex + 2)
    .map((scene, offset) => ({
      sceneId: scene.sceneId,
      title: scene.title,
      summary: scene.summary,
      chunkIndexes: scene.chunkIndexes,
      position: offset === 0 && sectionIndex > 0
        ? 'previous'
        : scene.sceneId === scenePlan.sceneId
          ? 'current'
          : 'next',
    }));
  const sectionContinuityContext = {
    previousScene: previousScene
      ? {
          sceneId: previousScene.sceneId,
          title: previousScene.title,
          summary: previousScene.summary,
          chunkIndexes: previousScene.chunkIndexes,
          carryIn: previousContinuity,
          closingPages: buildBoundaryPagePreview(previousScenePages, 'end'),
          carryOverCharacters: summarizeCharacterContext(previousScenePages, 6).map((character) => character.name),
        }
      : previousContinuity
        ? {
            carryIn: previousContinuity,
          }
        : null,
    currentScene: {
      sceneId: scenePlan.sceneId,
      title: scenePlan.title,
      summary: scenePlan.summary,
      chunkIndexes: scenePlan.chunkIndexes,
      relatedChunkContinuity: relatedChunks.map((chunk) => ({
        index: chunk.index,
        title: chunk.title,
        summary: chunk.summary,
        continuitySummary: chunk.continuitySummary,
      })),
      characterMatrix: currentSceneCharacters,
      openingPages: buildBoundaryPagePreview(relatedPageAnalyses, 'start'),
      closingPages: buildBoundaryPagePreview(relatedPageAnalyses, 'end'),
    },
    nextScene: nextScene
      ? {
          sceneId: nextScene.sceneId,
          title: nextScene.title,
          summary: nextScene.summary,
          chunkIndexes: nextScene.chunkIndexes,
          openingPages: buildBoundaryPagePreview(nextScenePages, 'start'),
          likelyCarryOverCharacters: summarizeCharacterContext(nextScenePages, 6).map((character) => character.name),
        }
      : null,
    sceneWindow,
  };
  const sceneSourceBlock = [
    `【本节标题】`,
    scenePlan.title,
    '',
    `【本节摘要】`,
    scenePlan.summary,
    '',
    `【相关块】`,
    stringifyPromptData(relatedChunks),
    '',
    `【相关逐页分析】`,
    stringifyPromptData(relatedPages),
    '',
    `【人物与世界约束】`,
    stringifyPromptData({
      storyOverview: storySynthesis.storyOverview,
      worldGuide: storySynthesis.worldGuide,
      characterGuide: storySynthesis.characterGuide,
      writingConstraints: storySynthesis.writingConstraints,
    }),
  ].join('\n');
  const enrichedSceneSourceBlock = [
    'Use the current section as the main source of truth. Use previous and next scene context only to smooth transitions, preserve character consistency, and maintain narrative continuity.',
    '',
    sceneSourceBlock,
    '',
    'Section continuity context',
    stringifyPromptData(sectionContinuityContext),
    '',
    'Current scene character matrix',
    stringifyPromptData(currentSceneCharacters),
  ].join('\n');

  const variables: Record<string, string> = {
    chunkHeader: sectionIndex === 0
      ? '这是小说的开篇章节，请基于以下结构化场景资料开始创作。'
      : `这是小说的第 ${sectionIndex + 1} 节，请基于以下结构化场景资料继续创作。`,
    summaryBlock: storySynthesis.storyOverview ? `【全书剧情概览】\n${storySynthesis.storyOverview}` : '',
    endingBlock: previousContinuity ? `【前一节承接】\n${previousContinuity}` : '',
    continuationBlock: enrichedSceneSourceBlock,
    outputInstruction: '请只根据以上资料创作，并严格按 JSON 输出 novelText 与 continuitySummary。',
  };

  let renderedPrompt = runtimeTemplate;
  for (const [key, value] of Object.entries(variables)) {
    renderedPrompt = renderedPrompt.split(`{{${key}}}`).join(value);
  }

  return renderedPrompt
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
