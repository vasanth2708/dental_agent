# 🦷 Bright Smile Dental Chatbot

A dental practice management chatbot built with Node.js, React, and multi-provider AI support (DeepSeek & Google Gemini).

## Loom Video Link - https://www.loom.com/share/192f25f3efc247bea92527e50004c8ef?sid=2d441a16-b557-41bb-a97c-b710b8965585
## 🎯 Features

### Core Capabilities
- **Natural Conversation**: Context-aware interactions with session management
- **Patient Management**: New patient registration & existing patient lookup with validation
- **Appointment Scheduling**: Individual and family bookings with slot management
- **Emergency Handling**: Priority routing for urgent dental issues with staff notifications
- **General Inquiries**: Hours, insurance, location information with instant cache responses
- **Learning Cache**: Caches frequent questions and improves responses over time

### Advanced Features
- **Multi-AI Provider Support**: DeepSeek and Google Gemini integration with fallback options
- **Context-Aware Responses**: Remembers conversation history with session persistence
- **Dynamic Prompt Optimization**: Only loads relevant examples (53-62% token reduction)
- **Family Member Management**: Links family appointments to primary patient with embedded relationships
- **Slot Allocation**: Handles insufficient availability with alternative suggestions
- **Conversation Analytics**: Tracks user feedback and common questions with detailed insights
- **Interactive UI**: Clickable buttons for dates, times, and actions with feedback tracking
- **Session Management**: Persistent conversation state with cleanup

## 🚀 Quick Start

### Prerequisites
- Node.js 16+
- AI Provider API Key (DeepSeek or Google Gemini)

### Installation

```bash
# Clone repository
git clone <repository-url>
cd dentalAgent

# Install backend dependencies
cd backend
npm install

# Install frontend dependencies
cd ../frontend
npm install
```

### Configuration

Create `backend/.env`:
```env
# AI Provider Configuration (choose one)
AI_PROVIDER=deepseek  # or 'gemini'
DEEPSEEK_API_KEY=your_deepseek_api_key_here
GEMINI_API_KEY=your_gemini_api_key_here

# Server Configuration
PORT=5000
FRONTEND_URL=http://localhost:3000
SESSION_SECRET=your_session_secret_here
```

### Running

```bash
# Terminal 1 - Backend
cd backend
npm start

# Terminal 2 - Frontend
cd frontend
npm start
```

Access at: `http://localhost:3000`

## 📁 Project Structure

```
dentalAgent/
├── backend/
│   ├── server.js              # Main Express server with multi-AI support
│   ├── config/
│   │   ├── prompts.js         # AI prompts & dynamic context builder
│   │   └── practice-info.json # Practice details & configuration
│   ├── data/                  # JSON database (modular structure)
│   │   ├── patients.json      # Patient records with embedded family members
│   │   ├── appointments.json  # All appointments (past and future)
│   │   ├── available-slots.json # Open time slots per day
│   │   ├── conversation-logs.json # Chat history for analytics
│   │   ├── emergency-alerts.json # Urgent cases for staff attention
│   │   └── sessions.json      # Session state persistence
│   └── utils/
│       ├── database-manager.js   # Database operations & file management
│       ├── learning-cache.js     # Smart caching system with auto-learning
│       ├── analytics.js          # Conversation analytics & insights
│       └── session-manager.js    # Session state management
└── frontend/
    └── src/
        ├── App.js             # Main React component with interactive UI
        └── App.css            # Modern styling with animations
```

## 🔧 Key Technologies

- **Backend**: Node.js, Express.js, Express Sessions
- **Frontend**: React 18, Framer Motion, Axios
- **AI Providers**: DeepSeek Chat API, Google Gemini API
- **Database**: JSON files (modular structure with embedded relationships)
- **Session Management**: File-based session persistence
- **Analytics**: Custom conversation tracking and feedback system
- **Caching**: In-memory learning cache with auto-population

## 💡 How It Works

### 1. Conversation Flow
```
User Input → Session Management → Context Detection → Learning Cache Check → 
Dynamic Prompt Building → AI Processing (DeepSeek/Gemini) → Function Execution → 
Natural Response Generation → User Feedback Collection → Analytics Update
```

### 2. Function Calling
The AI uses structured actions to interact with the system:
```javascript
[ACTION: search_patient({"phone": "1234567890"})]
[ACTION: book_appointment({...})]
[ACTION: book_family_appointments({...})]
[ACTION: register_new_patient({...})]
[ACTION: notify_staff_emergency({...})]
```

### 3. Context Management
Only relevant examples are included in each request:
- First message: Phone check example only (~2300 tokens)
- Family booking: Phone + family examples (~4000 tokens)
- Simple question: Core prompt only (~2000 tokens)
- Emergency: Emergency-specific prompts (~2500 tokens)

**Token Savings**: 53-62% reduction compared to static prompts

### 4. Session & State Management
- Persistent conversation state across server restarts
- Patient information stored in session for context
- Automatic session cleanup after 24 hours
- Real-time session statistics and monitoring

## 📊 API Endpoints

### Chat
```
POST /api/chat
Body: { message: string, conversationId?: string }
Response: { message: string, conversationId: string, messageId: string }
```

### Analytics
```
GET /api/analytics
Response: { analytics, insights, performance metrics }
```

### Feedback
```
POST /api/feedback
Body: { messageId: string, conversationId: string, feedback: 'helpful' | 'not-helpful', comment?: string }
```

### Session Management
```
GET /api/sessions/stats
Response: { totalSessions, activeLast5Min, activeLast1Hour }

GET /api/conversations/:conversationId
Response: { conversationId, messageCount, session, messages }
```

### Practice Information
```
GET /api/practice-info
Response: { name, address, contact, hours, insurance, appointmentTypes }
```

## 🎨 UI Features

- **Interactive Options**: Dates, times, appointment types auto-send on click with smooth animations
- **Visual Hierarchy**: `✅` for confirmations (non-clickable), `-` for options (clickable), `•` for lists
- **Feedback System**: 👍/👎 buttons for responses with instant submission
- **Cache Indicators**: ⚡ badge for instant cached responses
- **Smart Parsing**: Detects and renders clickable options from responses
- **Session Persistence**: Maintains conversation state across browser refreshes
- **Responsive Design**: Mobile-friendly interface with modern styling
- **Practice Info Sidebar**: Practice information display

## 📈 Performance Metrics

- **Response Time**: <2s for cached queries, <5s for provider queries
- **Token Usage**: ~2000-4500 tokens per request (dynamic based on context)
- **API Cost**: ~$0.35 per 100 conversations (DeepSeek), ~$0.50 per 100 conversations (Gemini)
- **Cache Hit Rate**: 80-90% for common questions, tracked in analytics dashboard
- **Session Performance**: <50ms session retrieval, cleanup every hour
- **Database Operations**: Parallel file reads, <100ms for patient lookups

## 🔐 Security

- API keys stored in environment variables with validation
- CORS configured for frontend domain with credentials support
- Session-based conversation tracking with secure cookies
- Conversation logs for audit trail with error tracking
- Input validation for all user data (phone numbers, names, dates)
- No sensitive data exposed in prompts
- Session cleanup to prevent data accumulation

## 🧪 Testing

```bash
# Run backend
cd backend && npm start

# Test scenarios:
1. New patient registration: "I'm a new patient" → follow registration flow
2. Existing patient: Enter registered phone number (e.g., "1234567890")
3. Family booking: "Schedule appointments for my family" with multiple names
4. Emergency: "I have a dental emergency" → emergency protocol
5. General questions: "What are your hours?" → cache response
6. Session persistence: Refresh browser → conversation continues
7. Feedback system: Rate responses with 👍/👎 buttons
```

## 🤝 Contributing

Built as part of a dental practice management system assessment.

---
