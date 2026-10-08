# 🎓 SMR — Student Mark Recognition

> AI-powered exam grading for Ethiopian schools, colleges, and universities.
> Teachers upload a photo of a handwritten answer sheet. AI reads it, grades it, and explains every mistake.

---

## 🎯 The Problem

In Ethiopian secondary schools and universities, exam grading is:

- **Slow** — a teacher with 60 students × 50 questions spends 8+ hours per exam
- **Error-prone** — manual tallying causes mistakes in rankings and final grades
- **Opaque** — students receive only a total score, not feedback on which answers were wrong
- **Repetitive** — the same exam is graded by hand, exam after exam

## 💡 The Solution

**SMR** automates the entire grading workflow:

1. Teacher creates an exam with correct answers
2. Teacher uploads a student answer sheet (a phone photo works)
3. AI reads the handwriting using Groq vision model
4. System auto-grades every question against the answer key
5. AI explains each wrong answer with real facts
6. Rankings computed across class, grade, school, system
7. Student sees results with per-question ✓/✗ and AI explanations

**Result:** A 60-student exam drops from 8 hours to under 1 hour with higher accuracy.

---

## ✨ Features

### Admin Dashboard
- Manage teachers and students (create, ban, restore)
- View/reset any user password
- Add private notes to any user account
- Change own login ID and password (protected by secret codes)
- View system-wide cumulative rankings
- Generate bulk reports filtered by grade, field, section, or exam
- Print / CSV / PDF export of any report
- Adjust per-question marks for any student
- AI Assistant

### Teacher Dashboard
- Register students with assigned login IDs
- Create courses and exams
- Build answer keys — type, upload photo, or bulk paste (1.A 2.B 3.C)
- Upload student answer sheets (single, multi-page, or camera)
- AI reads handwriting and fills answers
- Review and override any auto-graded mark
- Confirm and lock finalized results
- Rank students across multiple dimensions
- AI Assistant

### Student Dashboard
- View all exam results with score and percentage
- See own answer sheet image with ✓/✗ overlays
- AI explanations for every wrong answer
- Per-exam rank across 5 dimensions
- Cumulative rank with anonymized comparison to peers
- AI Tutor for subject questions

---

## 🛠 Tech Stack

| Layer | Technology |
|---|---|
| Frontend | Plain HTML + CSS + JavaScript |
| Backend | Supabase (Postgres + Auth + Storage) |
| AI (Vision) | Groq — qwen/qwen3.8-27b |
| AI (Text) | Groq — openai/gpt-oss-120b |
| Local OCR | Tesseract.js |
| Security | Supabase Edge Function (Deno) |

---

## 🏗 Architecture

    BROWSER (HTML/JS)
        |
        +---> SUPABASE (Postgres, Auth, Storage, RLS)
        |
        +---> EDGE FUNCTION (quick-action)
                  |
                  +---> GROQ API (with server-side API key)

The browser NEVER holds the Groq API key. All AI requests route through a Supabase Edge Function.

## 🗄 Database Schema

Tables:
- schools
- profiles (admin, teacher, student)
- teacher_subjects
- courses
- exams
- answer_keys
- submissions
- submission_answers
- password_reset_requests

Views:
- student_rankings (per-exam ranks at 5 levels)
- cumulative_rankings (system-wide totals)

RPC Functions:
- get_login_options
- admin_create_user, teacher_preregister_student
- register_user_password
- admin_change_own_login_id, admin_change_own_password
- admin_reset_user_password
- confirm_submission, unconfirm_submission
- admin_adjust_marks

---

## 🔒 Security Model

| Risk | Mitigation |
|---|---|
| API key theft | Groq key stored only in Edge Function secret. Never exposed to browser. |
| Unauthorized access | Row Level Security enforced on every table. |
| Password leakage | bcrypt hashed in auth.users. |
| ID collision | Unique constraint on (login_id, role). |
| Role switching | Login auto-detects role server-side. |
| Session hijacking | 30-minute idle timeout with warning. |

## 📊 OCR Accuracy

Measured across 100 test answers:

| Input Type | Accuracy |
|---|---|
| Printed text | 96% |
| Clean handwriting | 92% |
| Normal handwriting | 85% |
| Messy handwriting | 70% |
| Faded pencil | 60% |

Full report: docs/accuracy-report.md

**Design decision:** teacher always reviews AI output before saving. Human-AI hybrid achieves ~100% effective grading accuracy.

## ✅ Automated Tests

50+ tests covering answer normalization, key parsing, OCR parsing, CSV escaping, grading logic, database schema, RPC functions, and RLS policies.

Run them: open tests/index.html in a browser and click "Run All Tests".

---

## 🚀 Getting Started

1. Create a Supabase project (free tier).
2. Run the schema SQL in the Supabase SQL Editor.
3. Create a Storage bucket named `answer-sheets`.
4. In `js/supabase-client.js`, set your SUPABASE_URL and SUPABASE_ANON_KEY.
5. Create the AI proxy:
   - Supabase Dashboard -> Edge Functions -> New Function
   - Name it `quick-action`
   - Paste the proxy code
   - Add secret GROQ_API_KEY = your Groq key
   - Deploy
6. Create the admin user in Supabase Authentication, then link it to a profiles row with role='admin'.
7. Open `login.html` in any modern browser.

**No build step. No server required. Runs from the file system.**

## 🧗 Challenges & Solutions

### 1. Supabase Auth only supports email + password
Our system uses IDs (like TCH-001). Solution: the app synthesizes `{login_id}@smr.local` behind the scenes. User never sees it.

### 2. RLS blocked legitimate inserts
Insert policies per role needed explicit `WITH CHECK` clauses. Used SECURITY DEFINER functions for admin operations.

### 3. AI key could leak in browser
Built a Supabase Edge Function proxy. Key is a server-side secret.

### 4. Handwriting OCR returned inconsistent formats
Built a 3-pattern parser handling `1=A`, `1) A`, `1 A`, `1A`, `Q1=A`.

### 5. Duplicate question numbers in answer keys
Added UNIQUE constraint on (exam_id, question_number).

## 🔮 Future Work

- React frontend
- Image preprocessing (deskew, contrast)
- Offline PWA mode
- Amharic language support
- Parent dashboard
- Custom OCR trained on Ethiopian handwriting

## 👤 Author

**Teshome Ayenew** — Ethiopia — October 2026

## 📞 Support

Telegram: @TE21HUSH

