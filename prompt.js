// ============================================
// prompt.js - Prompt 模板 + GLM API 调用
// ============================================

// ---- GLM API ----

const GLM_API_KEY = 'REMOVED_SECRET';
const GLM_API_URL = 'https://open.bigmodel.cn/api/paas/v4/chat/completions';

async function callGLM(systemPrompt, userPrompt) {
  try {
    const response = await fetch(GLM_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + GLM_API_KEY
      },
      body: JSON.stringify({
        model: 'glm-4-flash',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        temperature: 0.7,
        max_tokens: 2048
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error('GLM API error:', response.status, errText);
      return null;
    }

    const data = await response.json();
    return data.choices[0].message.content;
  } catch (err) {
    console.error('GLM API call failed:', err);
    return null;
  }
}

// ---- 行程规划 Prompt ----

const PLANNING_SYSTEM_PROMPT = `你是一个旅行行程规划助手，会根据用户历史偏好不断改进。

你不仅是一个行程生成器，还是一个善于观察用户的助手。在每次交互中，关注用户透露的偏好信息。

严格按以下格式输出行程，不要输出任何思考过程：

## 📋 行程策略总结
用2-3句话概述设计思路。

## 🗓️ 行程安排
### 第 1 天
- 上午：具体地点 + 活动
- 中午：具体餐饮推荐
- 下午：具体地点 + 活动
- 晚上：具体活动

（每天都要写）

## 💡 设计说明
- 本次满足了哪些偏好
- 做了哪些调整

规则：
1. 禁止输出分析过程，直接给结果
2. 没有目的地时主动询问或推荐
3. 每个活动必须写具体地点名
4. 利用用户偏好自主调整方案
5. 每个地点后面标注经纬度，格式：地点名（纬度,经度），例如"西湖（30.2421,120.1487）"。这是为了在地图上标记，必须标注。如果不确定精确坐标，给出大致坐标即可。`;

// ---- 偏好提取 Prompt（每轮对话都会调用） ----

const PREFERENCE_EXTRACTION_PROMPT = `你是一个用户偏好提取器。你的唯一任务是判断用户消息中是否包含**跨场景通用的旅行偏好**。

【绝对不要提取的内容】以下内容只是本次旅行的临时需求，不是偏好，禁止提取：
- 目的地（如"去杭州"、"去京都"）
- 时长（如"玩两天"、"三天两夜"）
- 预算（如"预算2000"）
- 指令（如"帮我规划"、"推荐一下"）
- 人数（如"两个人"）

【应该提取的内容】以下内容反映了用户的通用偏好，可以跨多次旅行适用：
- 节奏偏好："不喜欢赶"、"喜欢轻松" → 偏好宽松节奏
- 地点类型："不想去人多的地方" → 偏好小众非游客化景点
- 时间习惯："不想早起" → 偏好晚起
- 兴趣类型："喜欢咖啡店" → 偏好咖啡文化体验
- 饮食偏好："不爱吃辣" → 口味偏好清淡
- 出行方式："不喜欢跨区太多" → 偏好同区域集中游览

【判断标准】这条信息如果用户下次去别的城市也可能适用，那就是偏好。如果只跟本次目的地相关，就不是。

如果消息中没有跨场景的通用偏好，返回空数组。

输出JSON：
{"new_preferences":[{"rule":"","confidence":0.8,"source":""}]}`;

// ---- 行程规划 ----

function buildPlanningUserPrompt(request, preferences) {
  let prompt = `## 当前用户需求\n${request}\n\n`;

  if (preferences.length > 0) {
    prompt += `## 用户已知的偏好（请在规划中体现这些偏好）\n`;
    preferences.forEach((p, i) => {
      prompt += `${i + 1}. ${p.rule}`;
      if (p.source) prompt += `（用户说过："${p.source}"）`;
      prompt += ` [置信度 ${(p.confidence * 100).toFixed(0)}%]\n`;
    });
    prompt += '\n重要：不要复述偏好，要让它们真正影响你的规划决策。在"设计说明"中说明你做了哪些调整。';
  } else {
    prompt += `这是首次交互，暂无用户偏好记录。`;
  }

  return prompt;
}

async function smartPlanning(request, preferences) {
  const userPrompt = buildPlanningUserPrompt(request, preferences);
  const apiResult = await callGLM(PLANNING_SYSTEM_PROMPT, userPrompt);
  if (apiResult) return apiResult;
  return '抱歉，行程生成失败，请重试。';
}

// ---- 偏好提取（每轮都调用） ----

function buildExtractionUserPrompt(userMessage, allUserMessages) {
  let prompt = `## 当前用户消息\n${userMessage}\n\n`;
  if (allUserMessages.length > 1) {
    prompt += `## 对话上下文（用户之前说过的）\n`;
    allUserMessages.slice(0, -1).forEach((msg, i) => {
      prompt += `${i + 1}. ${msg}\n`;
    });
    prompt += '\n';
  }
  prompt += `请从以上内容中提取用户的旅行偏好。注意结合上下文理解用户的真实意图。`;
  return prompt;
}

async function extractPreferences(userMessage, allUserMessages) {
  const userPrompt = buildExtractionUserPrompt(userMessage, allUserMessages);
  const apiResult = await callGLM(PREFERENCE_EXTRACTION_PROMPT, userPrompt);

  if (apiResult) {
    try {
      let jsonStr = apiResult.trim();
      const jsonMatch = jsonStr.match(/\{[\s\S]*\}/);
      if (jsonMatch) jsonStr = jsonMatch[0];
      const parsed = JSON.parse(jsonStr);
      return normalizePreferences(parsed);
    } catch (e) {
      console.error('Failed to parse preference extraction:', e, '\nRaw:', apiResult);
    }
  }

  return { new_preferences: [] };
}

// 标准化偏好提取结果
function normalizePreferences(data) {
  const result = { new_preferences: [] };

  const prefs = data.new_preferences || data.preferences || [];
  if (Array.isArray(prefs)) {
    prefs.forEach(p => {
      const rule = p.rule || p.description || p.preference || '';
      if (rule.trim()) {
        result.new_preferences.push({
          rule: rule,
          confidence: typeof p.confidence === 'number' ? p.confidence : 0.6,
          source: p.source || ''
        });
      }
    });
  }

  // 兼容单条格式
  if (result.new_preferences.length === 0 && data.preference) {
    const p = data.preference;
    if (typeof p === 'object') {
      const rule = p.rule || p.description || '';
      if (rule) result.new_preferences.push({ rule, confidence: p.confidence || 0.6, source: p.source || '' });
    } else if (typeof p === 'string') {
      result.new_preferences.push({ rule: p, confidence: 0.6, source: '' });
    }
  }

  return result;
}

// 保留构建器
function buildPlanningPrompt(request, preferences) {
  return {
    system: PLANNING_SYSTEM_PROMPT,
    user: buildPlanningUserPrompt(request, preferences)
  };
}
