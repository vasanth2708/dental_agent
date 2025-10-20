import * as db from './database-manager.js';

/**
 * Analyze conversation logs to identify patterns and improve chatbot
 */
export async function analyzeConversations() {
  try {
    const logs = await db.readData('conversationLogs');
    const conversationLogs = logs.conversationLogs || [];

    if (conversationLogs.length === 0) {
      return {
        totalConversations: 0,
        topQuestions: [],
        avgMessagesPerConversation: 0,
        emergencyCount: 0,
        bookingSuccessRate: 0
      };
    }

    // Group logs by conversation ID
    const conversations = groupByConversationId(conversationLogs);
    
    // Find most asked questions
    const topQuestions = findMostAskedQuestions(conversationLogs);
    
    // Calculate average messages per conversation
    const avgMessages = calculateAverageMessages(conversations);
    
    // Count emergencies
    const emergencyCount = countEmergencies(conversationLogs);
    
    // Calculate booking success rate
    const bookingRate = calculateBookingSuccessRate(conversationLogs);
    
    // Find common confusion points
    const confusionPoints = findConfusionPoints(conversationLogs);

    return {
      totalConversations: Object.keys(conversations).length,
      totalMessages: conversationLogs.length,
      topQuestions,
      avgMessagesPerConversation: avgMessages,
      emergencyCount,
      bookingSuccessRate: bookingRate,
      confusionPoints,
      lastUpdated: new Date().toISOString()
    };
  } catch (error) {
    console.error('Analytics error:', error);
    return null;
  }
}

/**
 * Group conversation logs by conversation ID
 */
function groupByConversationId(logs) {
  const grouped = {};
  logs.forEach(log => {
    if (!grouped[log.conversationId]) {
      grouped[log.conversationId] = [];
    }
    grouped[log.conversationId].push(log);
  });
  return grouped;
}

/**
 * Find most frequently asked questions
 */
function findMostAskedQuestions(logs) {
  const questionCount = {};
  const questionResponses = {};

  logs.forEach(log => {
    if (log.role === 'user') {
      const question = log.message.toLowerCase().trim();
      questionCount[question] = (questionCount[question] || 0) + 1;
      
      // Store responses for learning
      if (!questionResponses[question]) {
        questionResponses[question] = [];
      }
    } else if (log.role === 'assistant') {
      // Link response to previous question
      const prevQuestion = Object.keys(questionCount)[Object.keys(questionCount).length - 1];
      if (prevQuestion && questionResponses[prevQuestion]) {
        questionResponses[prevQuestion].push(log.message);
      }
    }
  });

  // Sort by frequency
  const sorted = Object.entries(questionCount)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)
    .map(([question, count]) => ({
      question,
      count,
      frequency: count,
      // Get most common response for this question
      commonResponse: questionResponses[question]?.[0] || null
    }));

  return sorted;
}

/**
 * Calculate average messages per conversation
 */
function calculateAverageMessages(conversations) {
  const conversationIds = Object.keys(conversations);
  if (conversationIds.length === 0) return 0;

  const total = conversationIds.reduce((sum, id) => {
    return sum + conversations[id].length;
  }, 0);

  return Math.round(total / conversationIds.length * 10) / 10;
}

/**
 * Count emergency conversations
 */
function countEmergencies(logs) {
  const emergencies = logs.filter(log => 
    log.role === 'user' && 
    log.message.toLowerCase().includes('emergency')
  );
  return emergencies.length;
}

/**
 * Calculate booking success rate
 */
function calculateBookingSuccessRate(logs) {
  const bookingAttempts = logs.filter(log =>
    log.role === 'assistant' &&
    (log.message.includes('appointment') || log.message.includes('booking'))
  ).length;

  const bookingSuccesses = logs.filter(log =>
    log.role === 'assistant' &&
    (log.message.includes('Appointment Confirmed') || log.message.includes('Successfully booked'))
  ).length;

  if (bookingAttempts === 0) return 0;
  return Math.round((bookingSuccesses / bookingAttempts) * 100);
}

/**
 * Find points where users seem confused (repeated questions, errors)
 */
function findConfusionPoints(logs) {
  const confusionPoints = [];
  const conversations = groupByConversationId(logs);

  Object.entries(conversations).forEach(([convId, messages]) => {
    // Look for repeated similar questions
    for (let i = 0; i < messages.length - 1; i++) {
      if (messages[i].role === 'user' && messages[i + 1].role === 'user') {
        // Two user messages in a row = potential confusion
        confusionPoints.push({
          conversationId: convId,
          userMessage: messages[i].message,
          followUp: messages[i + 1].message,
          timestamp: messages[i].timestamp
        });
      }
    }
  });

  return confusionPoints.slice(0, 10); // Top 10 confusion points
}

/**
 * Track message feedback (helpful/not helpful)
 */
export async function recordFeedback(messageId, conversationId, feedback, userComment = null) {
  try {
    const feedbackData = {
      messageId,
      conversationId,
      feedback, // 'helpful' or 'not-helpful'
      userComment,
      timestamp: new Date().toISOString()
    };

    // Store in a new feedback collection
    const data = await db.readData('conversationLogs');
    if (!data.feedback) {
      data.feedback = [];
    }
    data.feedback.push(feedbackData);
    
    // ALSO attach feedback directly to the conversation log message
    const logIndex = data.conversationLogs.findIndex(
      log => log.conversationId === conversationId && 
             log.messageId === messageId
    );
    
    if (logIndex !== -1) {
      data.conversationLogs[logIndex].feedback = feedback;
      data.conversationLogs[logIndex].feedbackComment = userComment;
      data.conversationLogs[logIndex].feedbackTimestamp = feedbackData.timestamp;
      console.log(`✅ Feedback '${feedback}' attached to message in conversation ${conversationId}`);
    } else {
      console.warn(`⚠️ Message ${messageId} not found in conversation ${conversationId}`);
    }
    
    await db.writeData('conversationLogs', data);

    // Log feedback for analytics
    if (feedback === 'not-helpful') {
      const logEntry = data.conversationLogs[logIndex];
      if (logEntry) {
        console.log(`🔴 User marked as not helpful: "${logEntry.message?.substring(0, 50)}..."`);
      }
    } else if (feedback === 'helpful') {
      console.log(`🟢 User marked as helpful (messageId: ${messageId})`);
    }

    return { success: true, message: 'Feedback recorded' };
  } catch (error) {
    console.error('Error recording feedback:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Get insights for improving chatbot
 */
export async function getInsights() {
  const analytics = await analyzeConversations();
  if (!analytics) return null;

  const insights = {
    // Questions that should be cached
    shouldCache: analytics.topQuestions
      .filter(q => q.frequency >= 5)
      .map(q => ({
        question: q.question,
        response: q.commonResponse,
        reason: `Asked ${q.frequency} times`
      })),

    // Areas needing improvement
    improvements: [],

    // Performance metrics
    performance: {
      avgMessages: analytics.avgMessagesPerConversation,
      bookingRate: analytics.bookingSuccessRate,
      totalConversations: analytics.totalConversations
    }
  };

  // Suggest improvements based on metrics
  if (analytics.avgMessagesPerConversation > 10) {
    insights.improvements.push({
      area: 'Conversation Length',
      issue: 'Users need too many messages to complete tasks',
      suggestion: 'Add more direct options, reduce back-and-forth'
    });
  }

  if (analytics.bookingSuccessRate < 70) {
    insights.improvements.push({
      area: 'Booking Success',
      issue: `Only ${analytics.bookingSuccessRate}% booking success rate`,
      suggestion: 'Simplify booking flow, add clearer slot selection'
    });
  }

  if (analytics.confusionPoints.length > 5) {
    insights.improvements.push({
      area: 'User Confusion',
      issue: `${analytics.confusionPoints.length} confusion points detected`,
      suggestion: 'Review and clarify prompts where users repeat questions'
    });
  }

  return insights;
}

/**
 * Update cache based on learned patterns
 */
export async function updateCacheFromLearning(cacheMap) {
  const analytics = await analyzeConversations();
  if (!analytics) return;

  // Add frequently asked questions to cache
  analytics.topQuestions.forEach(q => {
    if (q.frequency >= 5 && q.commonResponse && !cacheMap.has(q.question)) {
      console.log(`📚 Learning: Adding "${q.question}" to cache (asked ${q.frequency} times)`);
      cacheMap.set(q.question, q.commonResponse);
    }
  });

  return cacheMap;
}

