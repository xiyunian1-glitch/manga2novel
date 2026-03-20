export type ErrorCategory =
  | 'auth'
  | 'rate-limit'
  | 'browser-unreachable'
  | 'gateway-proxy-failure'
  | 'output-truncated'
  | 'input-too-large'
  | 'html-response'
  | 'json-parse-failed'
  | 'upstream-no-capacity'
  | 'model-mismatch'
  | 'timeout'
  | 'safety-blocked'
  | 'upstream-empty'
  | 'other';

export interface TroubleshootingAdvice {
  category: ErrorCategory;
  categoryLabel: string;
  title: string;
  summary: string;
  checks: string[];
}

function normalizeErrorMessage(error: string): string {
  return error.replace(/\s+/g, ' ').trim();
}

function createAdvice(
  category: ErrorCategory,
  categoryLabel: string,
  title: string,
  summary: string,
  checks: string[]
): TroubleshootingAdvice {
  return {
    category,
    categoryLabel,
    title,
    summary,
    checks,
  };
}

export function getTroubleshootingAdvice(error?: string | null): TroubleshootingAdvice | null {
  const message = normalizeErrorMessage(String(error || ''));
  if (!message) {
    return null;
  }

  if (/401|403|unauthorized|authentication|invalid api key|incorrect api key|invalid key|permission denied/i.test(message)) {
    return createAdvice(
      'auth',
      '鉴权失败',
      'API Key 或权限校验没有通过',
      '这不是内容本身的问题，而是当前 key、权限或供应商协议不匹配。',
      [
        '检查 API Key 有没有填错、过期，或多贴了空格。',
        '确认当前协议和供应商匹配，例如 Gemini Key 不要走兼容接口。',
        '如果前面挂了网关或代理，确认它没有额外鉴权要求。',
      ]
    );
  }

  if (/429|rate limit|too many requests|quota|quota exceeded/i.test(message)) {
    return createAdvice(
      'rate-limit',
      '触发限流',
      '请求频率或额度被上游限制',
      '请求已经到达服务端，但当前 key 或模型被限流了。',
      [
        '等几十秒后再试一次。',
        '把并发调低一点，减少短时间内的请求数。',
        '检查当前 key 是否还有额度，必要时换 key 或换模型。',
      ]
    );
  }

  if ((/request failed\s*\(502\)|bad gateway|\b502\b/i.test(message)) && /fetch failed|targeturl|upstream/i.test(message)) {
    return createAdvice(
      'gateway-proxy-failure',
      '网关/代理失败',
      '兼容接口或中转网关在转发时失败了',
      '请求已经到达你配置的兼容接口或代理，但它继续转发到上游模型时失败了。',
      [
        '这类 502 通常是上游不稳定，可以直接重试当前步骤。',
        '把并发调低，减少网关同时转发的请求数。',
        '核对 baseUrl、模型 ID 和当前供应商是否真的匹配。',
        '如果错误里带了 targetUrl，优先检查那个上游地址是否可达，并确认它支持 /chat/completions。',
      ]
    );
  }

  if (/truncated the completion|finish_reason\s*=\s*length/i.test(message)) {
    return createAdvice(
      'output-truncated',
      '输出截断',
      '模型开始输出了，但中途撞上了输出上限',
      '这不是网络问题，而是模型输出到一半就被 max_tokens 截断了。',
      [
        '把 Chunk Size 再调小一点，减少单次要综合的内容。',
        '减少单次图片数，尤其是逐页分析阶段。',
        '换一个更擅长长输出的模型，或确认上游兼容接口真的支持更高输出上限。',
      ]
    );
  }

  if (/max_total_tokens|max_seq_len|prompt_tokens|context length|input (?:is )?too (?:long|large)/i.test(message)) {
    return createAdvice(
      'input-too-large',
      '输入过长',
      '这次请求的输入已经太大了',
      '图片、Prompt 或上文一起算进去后，已经接近或超过模型窗口。',
      [
        '减小 Chunk Size，降低每次一起处理的页数。',
        '减少单次图片数量，或把章节拆得更细。',
        '如果改过系统提示词，检查是否写得过长。',
      ]
    );
  }

  if (/local fallback proxy .* unreachable|run-local-dev\.cmd|run-local-preview\.cmd|ports?\s*8787-8797/i.test(message)) {
    return createAdvice(
      'browser-unreachable',
      '浏览器未到达',
      '浏览器直连失败后，本地兜底代理也没连上',
      '请求根本没有到模型，问题发生在浏览器、本地代理或端口连通性这层。',
      [
        '先看顶部状态灯，确认不是“代理未连接 (8787-8797)”。',
        '在本机启动 scripts/run-local-dev.cmd，或预览环境启动 scripts/run-local-preview.cmd。',
        '如果坚持浏览器直连第三方接口，确认对方允许 CORS。',
        '检查本机 8787-8797 端口是否被占用、被防火墙拦截，或代理进程是否已退出。',
      ]
    );
  }

  if (/network request could not reach|direct browser request could not reach|request failed before it reached the upstream model|request never reached the upstream model|failed to fetch|fetch failed|err_connection|econnreset|econnaborted|socket hang up/i.test(message)) {
    return createAdvice(
      'browser-unreachable',
      '浏览器未到达',
      '请求没有真正到达模型服务端',
      '更像是浏览器、网络、CORS、证书或代理问题，而不是模型内容本身报错。',
      [
        '核对 API URL / 代理地址是否正确，兼容接口通常需要指到 /v1 前缀。',
        '如果是浏览器直连第三方接口，确认对方允许 CORS，证书也没有问题。',
        '如果依赖本地代理，确认代理进程和端口都正常。',
      ]
    );
  }

  if (/returned HTML; check API URL or proxy settings|<!doctype html|<html[\s>]/i.test(message)) {
    return createAdvice(
      'gateway-proxy-failure',
      '网关/代理失败',
      '当前返回的不是模型 JSON，而像网页或错误页',
      '这通常不是模型响应，而是 API 地址填错了，或者被网关重写成了 HTML 页面。',
      [
        '检查 baseUrl 是否填成了官网页面、控制台地址，或缺少 /v1。',
        '兼容接口应返回 /models 和 /chat/completions，而不是 HTML 页面。',
        '可以先点“获取模型”验证当前地址是否真的是 API 入口。',
      ]
    );
  }

  if (/malformed json|did not return valid json|did not return a pages array|returned \d+ pages, expected \d+|json without/i.test(message)) {
    return createAdvice(
      'json-parse-failed',
      'JSON 解析失败',
      '模型有返回内容，但格式不符合程序预期',
      '这不是“没响应”，而是返回内容不稳定，程序没法安全继续解析。',
      [
        '优先换一个更稳一点的模型，尤其是需要严格 JSON 输出的阶段。',
        '把 Chunk Size 调小，让单次任务更简单。',
        '看“上次发送”里的 Prompt，确认没有把输出格式要求冲掉。',
      ]
    );
  }

  if (/no capacity available for model|at capacity|currently at capacity|capacity unavailable|server is busy|overloaded/i.test(message)) {
    return createAdvice(
      'upstream-no-capacity',
      '上游无容量',
      '请求已经到达上游，但当前模型没有空余容量',
      '这通常是供应商负载问题，不一定是你的配置错了。',
      [
        '等一会再试，或直接重试当前步骤。',
        '换一个同类但负载更低的模型。',
        '把并发调低，减少同时占用的请求数。',
      ]
    );
  }

  if (/model .* not found|unknown model|unsupported model|no such model|does not exist|model .* unavailable|not available on the server/i.test(message)) {
    return createAdvice(
      'model-mismatch',
      '模型不匹配',
      '当前供应商下没有这个模型，或模型 ID 写法不对',
      '问题在模型名和供应商的匹配关系，不是在内容本身。',
      [
        '先点一次“获取模型”，再从列表里直接选模型。',
        '确认填写的是该供应商支持的真实模型 ID。',
        '有些兼容平台不接受带厂商前缀的模型名，注意它们的实际写法。',
      ]
    );
  }

  if (/不支持图片消息|无法接收 image_url|unknown variant [`"]image_url[`"]|expected [`"]text[`"]/i.test(message)) {
    return createAdvice(
      'model-mismatch',
      '模型能力不匹配',
      '当前接口或模型不支持图片输入',
      '这一步需要把图片一起发给模型，但你现在选的接口只接受纯文本消息，所以请求一发出去就被拒了。',
      [
        '逐页分析这类含图片的阶段，改用支持视觉输入的模型。',
        '如果你想继续用 DeepSeek，可以只把它放到整书综合、写作前全书统稿、章节写作、全书润色这些纯文本阶段。',
        '最直接的做法是把图片阶段切到 Gemini，后面文本阶段再切回 DeepSeek。',
      ]
    );
  }

  if (/timed out|timeout|deadline exceeded/i.test(message)) {
    return createAdvice(
      'timeout',
      '请求超时',
      '模型响应太慢，或这次任务量对当前模型来说过重',
      '请求已经发出，但在可接受时间内没有完成。',
      [
        '减少单次图片数量或减小 Chunk Size。',
        '换更快的模型，先把流程跑通。',
        '检查代理和网络质量，避免长连接被中途断开。',
      ]
    );
  }

  if (/safety filtering|refused the request|cannot fulfill this request|sexually explicit|safety guidelines/i.test(message)) {
    return createAdvice(
      'safety-blocked',
      '上游拦截',
      '内容触发了上游模型或网关的安全策略',
      '这更像是供应商侧的策略拦截，不是程序自身异常。',
      [
        '检查 Prompt 里是否有过强、过敏感或容易误判的描述。',
        '尽量不要把过多补充要求和结构化格式要求混在一起。',
        '必要时换一个策略更稳定的模型或供应商。',
      ]
    );
  }

  if (/returned an empty completion .*completion_tokens\s*=\s*0|completion_tokens\s*=\s*0.*blocked or discarded the response|blocked or discarded the response/i.test(message)) {
    return createAdvice(
      'upstream-empty',
      '上游空回',
      '上游返回了成功结束，但正文一个 token 都没给',
      '这通常不是网络问题，而是上游模型或网关把结果静默拦掉、丢掉，或直接空回了。',
      [
        '打开“查看上次发送”，确认模型、地址、Prompt 和图片都符合预期。',
        '如果只在某些内容上出现，优先怀疑上游安全策略或兼容网关静默拦截。',
        '如果只是偶发，可以重试一次；如果连续出现，更建议换模型或供应商。',
      ]
    );
  }

  if (/returned an empty completion|empty response/i.test(message)) {
    return createAdvice(
      'upstream-empty',
      '上游空回',
      '请求发出去了，但上游没返回可用正文',
      '这是“有响应但没内容”，通常比普通网络错误更偏向供应商兼容性或模型稳定性问题。',
      [
        '优先换一个更稳定的模型再试。',
        '检查接口是否真的兼容当前协议，尤其是自建网关。',
        '打开“查看上次发送”，确认模型名、地址和 Prompt 都正常。',
      ]
    );
  }

  return createAdvice(
    'other',
    '其他问题',
    '需要进一步排查',
    '这是一条还没被专门归类的错误，建议结合上次请求内容一起看。',
    [
      '先看“查看上次发送”，确认模型、地址、图片数和 Prompt 是否符合预期。',
      '如果是兼容接口，优先验证 /models 和 /chat/completions 是否都能正常工作。',
      '保留原始错误，再试一个更小的任务，判断是配置问题还是内容规模问题。',
    ]
  );
}
