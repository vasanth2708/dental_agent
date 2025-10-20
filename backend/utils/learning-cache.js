/**
 * Smart Learning Cache
 * Automatically learns common questions and caches responses
 */

export class LearningCache {
  constructor() {
    this.cache = new Map();
    this.questionFrequency = new Map();
    this.questionResponses = new Map();
    this.minFrequencyThreshold = 3; // Cache after 3 occurrences
  }

  /**
   * Check if question is in cache
   */
  has(question) {
    const normalized = this.normalizeQuestion(question);
    return this.cache.has(normalized);
  }

  /**
   * Get cached response
   */
  get(question) {
    const normalized = this.normalizeQuestion(question);
    return this.cache.get(normalized);
  }

  /**
   * Record a question being asked
   */
  recordQuestion(question, response, wasHelpful = true) {
    const normalized = this.normalizeQuestion(question);

    // Track frequency
    const currentFreq = this.questionFrequency.get(normalized) || 0;
    this.questionFrequency.set(normalized, currentFreq + 1);

    // Store response if helpful
    if (wasHelpful) {
      if (!this.questionResponses.has(normalized)) {
        this.questionResponses.set(normalized, []);
      }
      this.questionResponses.get(normalized).push({
        response,
        timestamp: new Date().toISOString()
      });

      // Auto-cache if frequency threshold met
      if (currentFreq + 1 >= this.minFrequencyThreshold) {
        this.addToCache(normalized, response);
      }
    }
  }

  /**
   * Manually add to cache
   */
  addToCache(question, response) {
    const normalized = this.normalizeQuestion(question);
    if (!this.cache.has(normalized)) {
      console.log(`🧠 Learning Cache: Added "${question}" (frequency: ${this.questionFrequency.get(normalized)})`);
      this.cache.set(normalized, response);
    }
  }

  /**
   * Get statistics
   */
  getStats() {
    return {
      cacheSize: this.cache.size,
      totalQuestionsTracked: this.questionFrequency.size,
      topQuestions: this.getTopQuestions(10),
      cacheHitRate: this.calculateHitRate()
    };
  }

  /**
   * Get most frequently asked questions
   */
  getTopQuestions(limit = 10) {
    return Array.from(this.questionFrequency.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([question, frequency]) => ({
        question,
        frequency,
        cached: this.cache.has(question),
        responses: this.questionResponses.get(question) || []
      }));
  }

  /**
   * Calculate cache hit rate
   */
  calculateHitRate() {
    const totalQuestions = Array.from(this.questionFrequency.values())
      .reduce((sum, freq) => sum + freq, 0);
    
    const cachedQuestions = Array.from(this.cache.keys())
      .reduce((sum, key) => sum + (this.questionFrequency.get(key) || 0), 0);

    if (totalQuestions === 0) return 0;
    return Math.round((cachedQuestions / totalQuestions) * 100);
  }

  /**
   * Normalize question for matching
   */
  normalizeQuestion(question) {
    return question
      .toLowerCase()
      .trim()
      .replace(/[?!.]/g, '')
      .replace(/\s+/g, ' ');
  }

  /**
   * Clear cache
   */
  clear() {
    this.cache.clear();
    this.questionFrequency.clear();
    this.questionResponses.clear();
  }

  /**
   * Export cache data
   */
  export() {
    return {
      cache: Array.from(this.cache.entries()),
      frequency: Array.from(this.questionFrequency.entries()),
      responses: Array.from(this.questionResponses.entries())
    };
  }

  /**
   * Import cache data
   */
  import(data) {
    if (data.cache) {
      this.cache = new Map(data.cache);
    }
    if (data.frequency) {
      this.questionFrequency = new Map(data.frequency);
    }
    if (data.responses) {
      this.questionResponses = new Map(data.responses);
    }
  }
}

// Pre-populated common responses
export const commonResponses = new Map([
  ['what are your hours', '🕐 We\'re open Mon-Sat: 8:00 AM - 6:00 PM, Closed Sunday'],
  ['where are you located', '📍 123 Main Street, Suite 200, Springfield, IL 62701'],
  ['what is your phone number', '☎️ Call us at 555-DENTAL (555-336-8251)'],
  ['do you accept insurance', '💳 Yes! We accept all major dental insurance including Blue Cross, Aetna, Cigna, Delta Dental, MetLife, United Healthcare, and Humana'],
  ['do you have parking', '🅿️ Yes, we have free parking available'],
  ['are you wheelchair accessible', '♿ Yes, our office is wheelchair accessible'],
  ['what services do you offer', '🦷 We offer Cleanings, General Checkups, Emergency care, and more'],
  ['how do i cancel appointment', '📞 To cancel, please call us at 555-DENTAL (555-336-8251)'],
  ['can i reschedule', '📅 Yes! Please call us at 555-DENTAL or we can help you book a new appointment'],
  ['do you accept walk ins', '🚪 For emergencies, yes! For regular appointments, please book ahead']
]);

