// ============================================
// prompt.js - Prompt 模板 + GLM API 调用
// ============================================

async function callGLM(systemPrompt, userPrompt, history) {
  var messages = [{ role: 'system', content: systemPrompt }];

  // 加入历史对话
  if (history && history.length > 0) {
    history.forEach(function (msg) {
      messages.push(msg);
    });
  }

  messages.push({ role: 'user', content: userPrompt });

  try {
    const response = await fetch(GLM_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + GLM_API_KEY
      },
      body: JSON.stringify({
        model: 'glm-5',
        messages: messages,
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

## 交互风格
- 你是一个善于聊天的助手，不要一上来就生成完整行程
- 先跟用户聊天了解需求：去哪、几天、几个人、什么风格、预算
- 当信息足够时，问用户"需要我给你规划一个完整的行程吗？"
- 规划过程中可以确认"你觉得这个安排怎么样？"

## 何时生成行程
- 当用户明确要求规划行程，或者你确认了足够的信息后
- 不要在信息不充分时就输出完整行程

## 输出格式（仅在生成行程时使用）
严格按以下格式输出，不要输出任何思考过程：

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

## 📍 地点列表
按天分组，按游玩顺序列出所有要去的具体地点（不带时间和其他描述）：

### 第1天
1. 西湖
2. 灵隐寺
3. 楼外楼（孤山路店）

### 第2天
1. 河坊街
2. 宋城

规则：
1. 禁止输出分析过程，直接给结果
2. 没有目的地时主动询问或推荐
3. 每个活动必须写具体地点名，用**加粗**标记，例如：**西湖**、**灵隐寺**
4. 利用用户偏好自主调整方案
5. 如果用户还没告诉出发城市，可以问问"你从哪个城市出发？"
6. 如果聊到酒店/住宿，可以推荐附近的酒店
7. 如果知道出发城市≠目的地，行程必须包含：
   - 第一天开头：**去程交通**（推荐具体车次：**G1234 上海虹桥 08:00→杭州东 09:00**）
   - 最后一天结尾：**回程交通**（推荐具体车次）
8. 每天的行程要连贯——起始点是住宿地，终点回到住宿地附近
9. 城市内的通勤，说明具体方式（地铁X号线XX站→XX站、步行X分钟、打车约X元）
10. **重要**：生成行程时，必须在最后输出「## 📍 地点列表」，按天分组列出所有地点（包括车站等起点）。如果只是普通聊天（没在规划行程），不要输出这个列表`;

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

// ---- 详细行程总结 Prompt ----

const SUMMARY_SYSTEM_PROMPT = `你是一个旅行行程总结生成器。根据提供的行程数据，生成一份超级详细的行程文档，方便用户截图保存。

## 输出格式
严格按以下格式，不要输出思考过程：

## 🎯 行程概览
- 目的地、天数、出发城市
- 去程列车/航班信息
- 住宿信息
- 总体花费估算

## 🚄 去程交通
具体车次/航班建议（出发时间、到达时间、历时）

## 🗓️ 详细行程

### 第 1 天
| 时间 | 活动 | 地点 | 通勤方式 | 备注 |
|------|------|------|---------|------|
| 08:00 | 到达目的地 | 火车站 | - | 下车后... |
| 09:00 | 游览XXX | **XXX** | 地铁X号线XX站→XX站（约XX分钟） | 推荐... |

（每天都要详细时间表，精确到30分钟）

### 第 2 天
...

## 🚄 回程交通
具体车次建议

## 🏨 住宿信息
酒店名、地址、评分、参考价格

## 💰 预算估算
- 交通：约XX元
- 住宿：约XX元
- 门票：约XX元
- 餐饮：约XX元
- 总计：约XX元

## 💡 实用贴士
- 天气提醒
- 注意事项
- 省钱技巧

规则：
1. 每个地点用**加粗**标记
2. 餐厅要推荐具体菜品
3. 通勤方式要写具体：地铁几号线、哪站上车、哪站下车
4. 景点要有简短介绍
5. 时间安排要合理（不要排太满或太空）
6. 数据以用户提供的为准，缺少的信息用合理估算`;

// ---- 行程规划 ----

function buildPlanningUserPrompt(request, preferences) {
  let prompt = `## 当前用户需求\n${request}\n\n`;

  // 加入记住的目的地
  const destination = DataStore.getDestination();
  if (destination) {
    prompt += `## 目的地\n用户本次旅行目的地是：${destination}。所有行程规划必须围绕${destination}展开。\n\n`;
  }

  // 加入出发城市
  const departureCity = DataStore.getDepartureCity();
  if (departureCity) {
    prompt += `## 出发城市\n用户从 ${departureCity} 出发。第一天行程建议从目的地火车站开始，最后一天行程结束时回到火车站准备返程。\n\n`;
  }

  // 加入住宿信息
  const hotel = DataStore.getHotel();
  if (hotel) {
    prompt += `## 住宿地\n用户已选择住宿：${hotel.name}（${hotel.address || ''}）。每天行程应从住宿地出发，最后回到住宿地附近。\n\n`;
  }

  // 加入出行日期
  const travelDates = DataStore.getTravelDates();
  if (travelDates) {
    prompt += `## 出行日期\n${travelDates.start || ''} 至 ${travelDates.end || ''}\n\n`;
  }

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
  const history = DataStore.getChatHistory();
  const apiResult = await callGLM(PLANNING_SYSTEM_PROMPT, userPrompt, history);
  if (apiResult) {
    DataStore.addChatMessage('assistant', apiResult);
    return apiResult;
  }
  return '抱歉，行程生成失败，请重试。';
}

// ---- 偏好提取（每轮都调用） ----

function buildExtractionUserPrompt(userMessage, allUserMessages) {
  let prompt = `## 当前用户消息\n${userMessage}\n\n`;

  const destination = DataStore.getDestination();
  if (destination) {
    prompt += `## 当前目的地\n${destination}\n\n`;
  }

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
  const apiResult = await callGLM(PREFERENCE_EXTRACTION_PROMPT, userPrompt, null);

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
