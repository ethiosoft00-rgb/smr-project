// ============================================================
// ai.js
// All AI requests route through the Supabase Edge Function
// (quick-action) so the Groq API key never reaches the browser.
// Provides:
//   - callGroqChat   (text generation)
//   - callGroqVision (handwriting OCR)
//   - askAIForStudent / askAIForTeacher / askAIForAdmin
// ============================================================
// Shared AI helpers — all requests go through the Supabase Edge Function proxy.
// The Groq API key is stored server-side and never reaches the browser.

var AI_PROXY_URL = 'https://zqxpffqyiendlwxfumcf.supabase.co/functions/v1/quick-action';

async function callGroqAI(body) {
  var response = await fetch(AI_PROXY_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ body: body })
  });

  var text = await response.text();

  if (!response.ok) {
    throw new Error('Proxy HTTP ' + response.status + ': ' + text);
  }

  var data;
  try { data = JSON.parse(text); } catch (e) { throw new Error('Bad response: ' + text.substring(0, 200)); }
  return data;
}

async function callGroqChat(prompt, maxTokens, temperature) {
  var data = await callGroqAI({
    model: 'openai/gpt-oss-120b',
    messages: [{ role: 'user', content: prompt }],
    temperature: (temperature === undefined ? 0 : temperature),
    max_tokens: (maxTokens || 600)
  });
  if (data.error) throw new Error(data.error.message || JSON.stringify(data.error));
  if (data.choices && data.choices[0] && data.choices[0].message) return data.choices[0].message.content;
  return 'No answer.';
}

async function callGroqVision(prompt, imageBase64, maxTokens) {
  var data = await callGroqAI({
    model: 'qwen/qwen3.8-27b',
    messages: [{
      role: 'user',
      content: [
        { type: 'text', text: prompt },
        { type: 'image_url', image_url: { url: imageBase64 } }
      ]
    }],
    temperature: 0.1,
    max_tokens: (maxTokens || 800)
  });
  if (data.error) throw new Error(data.error.message || JSON.stringify(data.error));
  if (data.choices && data.choices[0] && data.choices[0].message) return data.choices[0].message.content;
  return '';
}

// ====== ROLE-SCOPED AI ASSISTANTS ======

async function askAIForStudent(question, profile, submissions, rankings) {
  var context = 'Student: ' + profile.full_name +
    '\nGrade: ' + (profile.grade_level || '-') +
    '\nField: ' + (profile.field || '-') +
    '\nSubmissions: ' + JSON.stringify(submissions || []) +
    '\nRankings: ' + JSON.stringify(rankings || []);
  var prompt = 'You are a helpful tutor for ' + profile.full_name + '. ' +
    'Discuss ONLY this student\'s data.\n\nContext:\n' + context +
    '\n\nStudent question: ' + question;
  return await callGroqChat(prompt, 600, 0.3);
}

async function askAIForTeacher(question, profile, exams, students) {
  var context = 'Teacher: ' + profile.full_name +
    '\nExams: ' + JSON.stringify(exams || []) +
    '\nStudents: ' + JSON.stringify((students || []).slice(0, 30));
  var prompt = 'You are a helpful assistant for teacher ' + profile.full_name +
    '.\n\nContext:\n' + context + '\n\nTeacher question: ' + question;
  return await callGroqChat(prompt, 600, 0.3);
}

async function askAIForAdmin(question, profiles, submissions) {
  var context = 'Total profiles: ' + (profiles || []).length +
    '\nTotal submissions: ' + (submissions || []).length +
    '\nSample: ' + JSON.stringify((profiles || []).slice(0, 30));
  var prompt = 'You are an administrative assistant for SMR.\n\nContext:\n' + context +
    '\n\nAdmin question: ' + question;
  return await callGroqChat(prompt, 600, 0.3);
}




