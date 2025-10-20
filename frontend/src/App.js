import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import axios from 'axios';
import './App.css';

const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:5000';

function App() {
  const [messages, setMessages] = useState([]);
  const [inputMessage, setInputMessage] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [conversationId, setConversationId] = useState(null);
  const [practiceInfo, setPracticeInfo] = useState(null);
  const [showOptions, setShowOptions] = useState(false);
  const [optionType, setOptionType] = useState(null);
  const [feedbackGiven, setFeedbackGiven] = useState(new Set()); // Track which messages have feedback
  const messagesEndRef = useRef(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  // Handle feedback submission
  const handleFeedback = async (messageId, feedbackType) => {
    try {
      await axios.post(`${API_URL}/api/feedback`, {
        messageId,
        conversationId,
        feedback: feedbackType
      });

      // Mark this message as having feedback
      setFeedbackGiven(prev => new Set(prev).add(messageId));
      
      console.log(`Feedback recorded: ${feedbackType}`);
    } catch (error) {
      console.error('Error submitting feedback:', error);
    }
  };

  useEffect(() => {
    // Fetch practice info
    axios.get(`${API_URL}/api/practice-info`)
      .then(response => setPracticeInfo(response.data))
      .catch(error => console.error('Error fetching practice info:', error));

    // Add welcome message with consistent formatting
    // ✅ = confirmations, • = lists, - = clickable options
    setMessages([{
      type: 'assistant',
      content: "👋 **Welcome to Bright Smile Dental!**\n\n**How can I help you today?**\n\n💡 **Quick Start:**\n- 👤 **New Patient** - Register & book first appointment\n- 🔍 **Existing Patient** - Share your phone number\n- ❓ **Questions** - Ask about hours, insurance, location\n- 🚨 **Emergency** - Need urgent care?\n\n**Just type or click an option!**",
      timestamp: new Date()
    }]);
  }, []);

  const sendOption = async (optionText) => {
    const userMessage = {
      type: 'user',
      content: optionText,
      timestamp: new Date()
    };

    setMessages(prev => [...prev, userMessage]);
    setShowOptions(false);
    setOptionType(null);
    setIsLoading(true);

    try {
      const response = await axios.post(`${API_URL}/api/chat`, {
        message: optionText,
        conversationId: conversationId
      });

      if (!conversationId) {
        setConversationId(response.data.conversationId);
      }

      const assistantMessage = {
        type: 'assistant',
        content: response.data.message,
        timestamp: new Date(),
        messageId: response.data.messageId, // For feedback tracking
        cacheHit: response.data.cacheHit
      };

      setMessages(prev => [...prev, assistantMessage]);
    } catch (error) {
      console.error('Error sending message:', error);
      const errorMessage = {
        type: 'assistant',
        content: "I apologize, but I'm having trouble connecting right now. Please try again in a moment or call us directly at 555-DENTAL.",
        timestamp: new Date(),
        isError: true
      };
      setMessages(prev => [...prev, errorMessage]);
    } finally {
      setIsLoading(false);
    }
  };

  const sendMessage = async (e) => {
    e.preventDefault();
    
    if (!inputMessage.trim()) return;

    const userMessage = {
      type: 'user',
      content: inputMessage,
      timestamp: new Date()
    };

    setMessages(prev => [...prev, userMessage]);
    setInputMessage('');
    setIsLoading(true);

    try {
      const response = await axios.post(`${API_URL}/api/chat`, {
        message: inputMessage,
        conversationId: conversationId
      });

      if (!conversationId) {
        setConversationId(response.data.conversationId);
      }

      const assistantMessage = {
        type: 'assistant',
        content: response.data.message,
        timestamp: new Date(),
        messageId: response.data.messageId, // For feedback tracking
        cacheHit: response.data.cacheHit
      };

      setMessages(prev => [...prev, assistantMessage]);
    } catch (error) {
      console.error('Error sending message:', error);
      const errorMessage = {
        type: 'assistant',
        content: "I apologize, but I'm having trouble connecting right now. Please try again in a moment or call us directly at 555-DENTAL.",
        timestamp: new Date(),
        isError: true
      };
      setMessages(prev => [...prev, errorMessage]);
    } finally {
      setIsLoading(false);
    }
  };

  const quickActions = [
    { text: "Schedule an appointment", icon: "📅" },
    { text: "I'm a new patient", icon: "👤" },
    { text: "Reschedule my appointment", icon: "🔄" },
    { text: "What are your hours?", icon: "🕐" },
    { text: "Do you accept my insurance?", icon: "💳" },
    { text: "I have a dental emergency", icon: "🚨" }
  ];

  const handleQuickAction = (text) => {
    setInputMessage(text);
  };

  const handleNewChat = () => {
    setMessages([]);
    setConversationId(null);
    setFeedbackGiven(new Set());
    setShowOptions(false);
    setOptionType(null);
  };

  const practiceInfo2 = practiceInfo;

  // Format message - convert markdown-like syntax to clean HTML
  // Formatting standards: ✅ = confirmations, • = lists, - = clickable options
  const formatMessage = (content) => {
    if (!content) return '';
    
    // Split by lines for better processing
    const lines = content.split('\n');
    const formatted = [];
    
    lines.forEach((line, idx) => {
      let processedLine = line;
      
      // Remove leading/trailing ** and clean up
      processedLine = processedLine.replace(/^\*\*(.+?)\*\*$/g, '$1');
      
      // Convert **bold** to <strong> but only for inline text
      processedLine = processedLine.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
      
      // Clean up any remaining **
      processedLine = processedLine.replace(/\*\*/g, '');
      
      // If it's a bullet point, format it nicely
      if (processedLine.match(/^[\s]*[-•]/)) {
        const bulletType = processedLine.match(/^[\s]*([-•])/)[1];
        processedLine = processedLine.replace(/^[\s]*[-•]\s*/, '');
        formatted.push(
          <div key={idx} className="message-bullet">
            {bulletType} {processedLine.split('<strong>').map((part, i) => {
              if (i === 0) return part;
              const [bold, rest] = part.split('</strong>');
              return <span key={i}><strong>{bold}</strong>{rest}</span>;
            })}
          </div>
        );
      } else if (processedLine.trim()) {
        // Regular line
        formatted.push(
          <div key={idx} className="message-line">
            {processedLine.split('<strong>').map((part, i) => {
              if (i === 0) return part;
              const [bold, rest] = part.split('</strong>');
              return <span key={i}><strong>{bold}</strong>{rest}</span>;
            })}
          </div>
        );
      } else {
        // Empty line (spacing)
        formatted.push(<div key={idx} className="message-spacer" />);
      }
    });
    
    return <div className="formatted-message">{formatted}</div>;
  };

  // Options data
  const appointmentOptions = [
    { label: 'Cleaning', icon: '🪥' },
    { label: 'General Checkup', icon: '👨‍⚕️' },
    { label: 'Emergency', icon: '🚨' }
  ];

  const insuranceOptions = [
    { label: 'Blue Cross Blue Shield', icon: '🏥' },
    { label: 'Aetna', icon: '🏥' },
    { label: 'Cigna', icon: '🏥' },
    { label: 'Delta Dental', icon: '🏥' },
    { label: 'No Insurance', icon: '💰' }
  ];

  const initialOptions = [
    { text: "I'm a new patient", icon: '👤' },
    { text: 'I have an existing appointment', icon: '📅' },
    { text: 'General questions', icon: '❓' }
  ];

  // Smart parser - extracts clickable options from backend messages
  // Formatting standards: ✅ = confirmations, • = lists, - = clickable options
  const parseAndRenderOptions = (content) => {
    const options = [];
    
    // Pattern 1: Extract ONLY clickable options with "-" (clickable options)
    // Use "•" for lists (non-clickable information)
    const clickablePattern = /^[\s]*-\s*([^\n]+?)$/gm;
    let match;
    
    while ((match = clickablePattern.exec(content)) !== null) {
      const optionText = match[1].trim();
      
      // Try to extract emoji and text in various formats
      // Format 1: "🪥 **Cleaning**"
      let emojiMatch = optionText.match(/^([^\w\s]+)\s*\*\*(.+?)\*\*/);
      if (emojiMatch) {
        options.push({
          emoji: emojiMatch[1].trim(),
          label: emojiMatch[2].trim(),
          fullText: emojiMatch[2].trim()
        });
        continue;
      }
      
      // Format 2: "Schedule a cleaning" or "Ask about insurance" (plain text)
      // Remove any leading emojis and use the text
      const cleanText = optionText.replace(/^[^\w\s]+\s*/, '').trim();
      if (cleanText) {
        options.push({
          emoji: '📋',
          label: cleanText,
          fullText: cleanText
        });
      }
    }
    
    // Pattern 2: Time slots like "9:00 AM, 10:00 AM, 11:00 AM"
    const timeSlotPattern = /(\d{1,2}:\d{2}\s*(?:AM|PM))/gi;
    const timeMatches = content.match(timeSlotPattern);
    const dateMatches = content.match(/\*\*October\s+\d+\*\*|October\s+\d+/gi);
    
    if (timeMatches && timeMatches.length > 3) {
      // Organize by date if available
      const dateGroups = [];
      if (dateMatches) {
        dateMatches.forEach((dateStr) => {
          const cleanDate = dateStr.replace(/\*\*/g, '').trim();
          // Find times after this date in the content
          const dateIndex = content.indexOf(dateStr);
          const nextDateIndex = dateMatches[dateMatches.indexOf(dateStr) + 1] 
            ? content.indexOf(dateMatches[dateMatches.indexOf(dateStr) + 1])
            : content.length;
          const section = content.substring(dateIndex, nextDateIndex);
          const timesInSection = section.match(timeSlotPattern) || [];
          
          if (timesInSection.length > 0) {
            dateGroups.push({
              date: cleanDate,
              times: [...new Set(timesInSection)] // Remove duplicates
            });
          }
        });
      }
      
      if (dateGroups.length > 0) {
        return (
          <>
            <p className="options-header">📅 Click any time to book:</p>
            <div className="date-slots-container">
              {dateGroups.map((group, idx) => (
                <div key={idx} className="date-group">
                  <div className="date-header">{group.date}</div>
                  <div className="time-slots">
                    {group.times.map((time, timeIdx) => (
                      <button
                        key={timeIdx}
                        className="time-slot-btn"
                        onClick={() => sendOption(`${group.date} at ${time}`)}
                      >
                        {time}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </>
        );
      }
    }
    
    // Pattern 3: Quick actions like "🆕 **Schedule New Appointment**"
    if (options.length > 0) {
      return (
        <div className="interactive-options">
          <p className="options-header">👇 Select an option:</p>
          <div className="option-cards">
            {options.map((option, idx) => (
              <button
                key={idx}
                className="option-card"
                onClick={() => sendOption(option.fullText)}
              >
                <span className="card-emoji">{option.emoji}</span>
                <span className="card-label">{option.label}</span>
              </button>
            ))}
          </div>
        </div>
      );
    }
    
    return null;
  };

  return (
    <div className="App">
      <div className="chat-container">
        {/* Header */}
        <div className="chat-header">
          <div className="header-content">
            <div className="logo">
              <div className="logo-icon">🦷</div>
              <div className="logo-text">
                <h1>Bright Smile Dental</h1>
                <p>AI Assistant - Always Here to Help</p>
              </div>
            </div>
            <div className="status-indicator">
              <div className="status-dot"></div>
              <span>Online</span>
            </div>
          </div>
        </div>

        {/* Messages */}
        <div className="messages-container">
          <AnimatePresence>
            {messages.map((message, index) => (
              <motion.div
                key={index}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.3 }}
              >
                <div className={`message ${message.type}`}>
                  {message.type === 'assistant' && (
                    <div className="message-avatar">
                      <span>👩‍⚕️</span>
                    </div>
                  )}
                  <div className="message-content">
                    <div className={`message-bubble ${message.isError ? 'error' : ''}`}>
                      {formatMessage(message.content)}
                    </div>
                    <div className="message-timestamp">
                      {message.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      {message.cacheHit && <span className="cache-badge" title="Instant response from learning cache">⚡</span>}
                    </div>
                    {/* Feedback buttons for assistant messages */}
                    {message.type === 'assistant' && message.messageId && !message.isError && (
                      <div className="feedback-buttons">
                        {!feedbackGiven.has(message.messageId) ? (
                          <>
                            <button
                              className="feedback-btn helpful"
                              onClick={() => handleFeedback(message.messageId, 'helpful')}
                              title="This was helpful"
                            >
                              👍 Helpful
                            </button>
                            <button
                              className="feedback-btn not-helpful"
                              onClick={() => handleFeedback(message.messageId, 'not-helpful')}
                              title="This was not helpful"
                            >
                              👎 Not Helpful
                            </button>
                          </>
                        ) : (
                          <span className="feedback-thanks">✅ Thanks for your feedback!</span>
                        )}
                      </div>
                    )}
                  </div>
                  {message.type === 'user' && (
                    <div className="message-avatar user">
                      <span>😊</span>
                    </div>
                  )}
                </div>

                {/* Smart option rendering - automatically detects and displays clickable options */}
                {message.type === 'assistant' && index === messages.length - 1 && !isLoading && (
                  <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.2 }}
                  >
                    {parseAndRenderOptions(message.content)}
                  </motion.div>
                )}
              </motion.div>
            ))}
          </AnimatePresence>

          {isLoading && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="message assistant"
            >
              <div className="message-avatar">
                <span>👩‍⚕️</span>
              </div>
              <div className="message-content">
                <div className="typing-indicator">
                  <span></span>
                  <span></span>
                  <span></span>
                </div>
              </div>
            </motion.div>
          )}
          
          <div ref={messagesEndRef} />
        </div>

        {/* Quick Actions - Removed duplicate, options shown below messages automatically */}

        {/* Input Form */}
        <div className="input-container">
          <form onSubmit={sendMessage} className="input-form">
            <input
              type="text"
              value={inputMessage}
              onChange={(e) => setInputMessage(e.target.value)}
              placeholder="Type your message here..."
              className="message-input"
              disabled={isLoading}
            />
            <button
              type="submit"
              className="send-button"
              disabled={isLoading || !inputMessage.trim()}
            >
              <svg
                width="24"
                height="24"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <line x1="22" y1="2" x2="11" y2="13"></line>
                <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
              </svg>
            </button>
          </form>
          <div className="input-footer">
            <p>🔒 Your information is secure and confidential</p>
          </div>
        </div>
      </div>

      {/* Practice Info Sidebar */}
      {practiceInfo2 && (
        <div className="practice-info">
          <h3>📍 Practice Information</h3>
          <div className="info-section">
            <p><strong>Location:</strong></p>
            <p>{practiceInfo2.address}</p>
          </div>
          <div className="info-section">
            <p><strong>Phone:</strong></p>
            <p>{practiceInfo2.phone}</p>
          </div>
          <div className="info-section">
            <p><strong>Hours:</strong></p>
            <p>Mon-Sat: {practiceInfo2.hours.monday}</p>
            <p>Sunday: {practiceInfo2.hours.sunday}</p>
          </div>
          <div className="info-section">
            <p><strong>Insurance Accepted:</strong></p>
            <ul>
              {practiceInfo2.insurance.slice(0, 4).map((ins, idx) => (
                <li key={idx}>{ins}</li>
              ))}
              <li>+ {practiceInfo2.insurance.length - 4} more</li>
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;

