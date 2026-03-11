import type { CreativePreset } from './types';

export const CUSTOM_PRESET_ID = 'custom';
export const SPECIAL_PROMPT_HEADING = '## 特殊提示词';
const LEGACY_SUPPLEMENTAL_PROMPT_HEADING = '## 补充提示';
export const ROLE_AND_STYLE_HEADING = '## 创作风格';

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

export const SYSTEM_PROMPT_BODY = `## 输出规则
1. 叙事必须承接前文，确保人物动机、关系与事件线一致
2. 将动作、表情、场景、镜头语言转写成文学描写，而不是简单罗列画面
3. 对话统一使用「」包裹，并保留角色个性与语气差异
4. 保留节奏感，关键场面适度放大，过场不要冗长
5. 注意环境、光线、气味、声音、触感等细节，增强临场感
6. 不要解释你在做什么，也不要输出额外注释

${OUTPUT_SCHEMA}`;

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
    sections.push(trimmedSystemPromptBody);
  }

  return sections.join('\n\n').trim();
}

export function splitSystemPrompt(systemPrompt: string): {
  supplementalPrompt: string;
  roleAndStyle: string;
  systemPromptBody: string;
} {
  const normalizedPrompt = systemPrompt.trim();
  const systemMarkers = ['## 你的任务', '## 输出规则'];
  const markerIndexes = systemMarkers
    .map((marker) => normalizedPrompt.indexOf(marker))
    .filter((index) => index !== -1);
  const systemStartIndex = markerIndexes.length > 0 ? Math.min(...markerIndexes) : -1;
  const promptPrefix = systemStartIndex === -1
    ? normalizedPrompt
    : normalizedPrompt.slice(0, systemStartIndex).trim();
  const rawSystemPromptBody = systemStartIndex === -1
    ? SYSTEM_PROMPT_BODY
    : normalizedPrompt.slice(systemStartIndex).trim();
  const systemPromptBody = rawSystemPromptBody === LEGACY_SYSTEM_PROMPT_BODY
    ? SYSTEM_PROMPT_BODY
    : rawSystemPromptBody;

  const supplementalPattern = `${SPECIAL_PROMPT_HEADING}|${LEGACY_SUPPLEMENTAL_PROMPT_HEADING}`;
  const supplementalMatch = promptPrefix.match(
    new RegExp(`(?:${supplementalPattern})\\s*([\\s\\S]*?)(?=\\n${ROLE_AND_STYLE_HEADING}|$)`)
  );
  const roleAndStyleMatch = promptPrefix.match(
    new RegExp(`${ROLE_AND_STYLE_HEADING}\\s*([\\s\\S]*?)$`)
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
    name: '成人文学风格',
    prompt: buildSystemPrompt('你是一位成人文学风格作者，强调复杂情感、身体感知与关系张力。表达成熟、克制、文学化，不使用低俗口吻。'),
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
  previousEnding: string
): string {
  const parts: string[] = [];

  if (chunkIndex === 0) {
    parts.push('这是漫画的开始。请分析以下图片，开始创作小说的开头。');
  } else {
    parts.push(`这是第 ${chunkIndex + 1} 组漫画图片。`);

    if (globalSummary) {
      parts.push(`\n【前文剧情摘要】\n${globalSummary}`);
    }

    if (previousEnding) {
      parts.push(`\n【前一组结尾】\n${previousEnding}`);
    }

    parts.push('\n请延续前文，继续创作。确保新内容与前文衔接自然。');
  }

  parts.push('\n请分析以下图片并严格按照 JSON 格式输出。');

  return parts.join('\n');
}
