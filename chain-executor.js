/**
 * ChainExecutor - Handles sequential execution of prompt chains
 * Each step's output becomes the next step's input
 * 
 * @module chain-executor
 * @description Provides sequential execution of prompt chains with streaming support,
 * timeout handling, and cancellation capabilities.
 */

// Constants
/**
 * Timeout for each chain step in milliseconds
 * @constant {number}
 */
const CHAIN_STEP_TIMEOUT = 120000; // 2 minutes per step

/**
 * Base delay for rate limit retries in milliseconds
 * @constant {number}
 */
const RATE_LIMIT_DELAY = 5000; // 5 seconds base delay

/**
 * Maximum number of retry attempts for rate-limited requests
 * @constant {number}
 */
const MAX_RETRIES = 3;

/**
 * ChainExecutor class for managing sequential prompt chain execution
 * @class
 */
class ChainExecutor {
  /**
   * Creates a new ChainExecutor instance
   * @param {Object} api - VeniceAPI instance for making calls
   * @param {Object} config - Chain configuration object
   * @param {string} config.id - Unique identifier for the chain
   * @param {Array<Object>} config.steps - Array of step configurations
   * @param {string} config.steps[].id - Step identifier
   * @param {string} config.steps[].promptTemplate - Template with {input} and {previous_output} placeholders
   * @param {string} config.steps[].systemPrompt - System prompt for the step
   * @param {string} config.steps[].model - Model to use for this step
   * @param {boolean} config.steps[].webSearch - Whether to enable web search
   * @param {boolean} config.steps[].includePreviousOutput - Whether to include previous step's output
   */
  constructor(api, config) {
    this.api = api;
    this.config = config;
    this.currentExecution = null;
    this.abortController = null;
  }

  /**
   * Execute the entire chain sequentially
   * Each step's output becomes the next step's input
   * 
   * @param {string} input - Initial user input
   * @param {Function} onStepStart - Called when a step starts (step, stepIndex)
   * @param {Function} onStepProgress - Called with streaming progress (step, stepIndex, chunk, thinking)
   * @param {Function} onStepComplete - Called when a step completes (step, stepIndex, result)
   * @param {Function} onError - Called on error (step, stepIndex, error)
   * @returns {Promise<Object>} - Execution result object
   * @throws {Error} If any step fails during execution
   * 
   * @example
   * const result = await executor.execute(
   *   'Analyze this data',
   *   (step, index) => console.log(`Starting step ${index}`),
   *   (step, index, chunk, thinking) => console.log(`Progress: ${chunk}`),
   *   (step, index, result) => console.log(`Step ${index} complete`),
   *   (step, index, error) => console.error(`Step ${index} failed:`, error)
   * );
   */
  async execute(input, onStepStart, onStepProgress, onStepComplete, onError) {
    this.currentExecution = this.createExecution(input);
    
    for (let i = 0; i < this.config.steps.length; i++) {
      if (this.currentExecution.status === 'cancelled') break;
      
      const step = this.config.steps[i];
      const stepInput = this.prepareStepInput(step, i, input);
      
      onStepStart(step, i);
      
      // Check context overflow before each step
      this.checkContextOverflow();
      
      try {
        const result = await this.executeStepWithRetry(step, stepInput, (chunk, thinking) => {
          onStepProgress(step, i, chunk, thinking);
        });
        
        this.currentExecution.results.push(result);
        onStepComplete(step, i, result);
        
      } catch (error) {
        this.currentExecution.status = 'failed';
        // Classify the error for better user messaging
        const classifiedError = this.classifyError(error);
        this.currentExecution.error = classifiedError.message;
        this.currentExecution.errorType = classifiedError.type;
        
        // Store partial results for recovery
        this.currentExecution.partialResults = this.currentExecution.results.slice();
        this.currentExecution.failedAtIndex = i;
        this.currentExecution.canRetry = true;
        
        onError(step, i, { ...error, classified: classifiedError });
        throw error;
      }
    }
    
    this.currentExecution.status = 'completed';
    this.currentExecution.completedAt = Date.now();
    return this.currentExecution;
  }

  /**
   * Create a new execution state object
   * @param {string} input - Initial input for the chain
   * @returns {Object} Execution state object
   * @private
   */
  createExecution(input) {
    return {
      id: `exec-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      chainId: this.config.id,
      status: 'running',
      currentStepIndex: 0,
      input: input,
      results: [],
      error: null,
      startedAt: Date.now(),
      completedAt: null
    };
  }

  /**
   * Prepare input for a specific step by processing the prompt template
   * Replaces {input} with original input and {previous_output} with the previous step's output
   * 
   * @param {Object} step - Step configuration object
   * @param {number} stepIndex - Index of the current step
   * @param {string} originalInput - Original user input
   * @returns {string} Processed input string
   * @private
   */
  prepareStepInput(step, stepIndex, originalInput) {
    let input = step.promptTemplate.replace('{input}', originalInput);
    
    if (step.includePreviousOutput && stepIndex > 0) {
      const prevOutput = this.currentExecution.results[stepIndex - 1]?.output || '';
      input = input.replace('{previous_output}', prevOutput);
    }
    
    return input;
  }

  /**
   * Execute a single step with streaming support and timeout handling
   * Uses Promise.race pattern for timeout management
   * 
   * @param {Object} step - Step configuration object
   * @param {string} input - Processed input for this step
   * @param {Function} onChunk - Callback for streaming chunks (chunk, thinking)
   * @returns {Promise<Object>} Step execution result
   * @throws {Error} If step times out or API call fails
   * @private
   */
  async executeStep(step, input, onChunk) {
    return new Promise((resolve, reject) => {
      this.abortController = new AbortController();
      
      // Set up timeout
      const timeoutId = setTimeout(() => {
        if (this.abortController) {
          this.abortController.abort();
        }
        reject(new Error('Step timeout exceeded'));
      }, CHAIN_STEP_TIMEOUT);

      this.api.streamChat(
        [step.systemPrompt],
        [{ role: 'user', content: input }],
        { model: step.model, webSearch: step.webSearch },
        (chunk, thinking) => {
          clearTimeout(timeoutId);
          onChunk(chunk, thinking);
        },
        (fullText, thinking, usage) => {
          clearTimeout(timeoutId);
          resolve({
            stepId: step.id,
            model: step.model,
            input,
            output: fullText,
            thinking,
            usage,
            status: 'completed',
            timestamp: Date.now()
          });
        },
        (error) => {
          clearTimeout(timeoutId);
          reject(error);
        }
      );
    });
  }

  /**
   * Cancel the current chain execution
   * Aborts any ongoing API call and marks execution as cancelled
   */
  cancel() {
    if (this.abortController) {
      this.abortController.abort();
    }
    if (this.currentExecution) {
      this.currentExecution.status = 'cancelled';
      this.currentExecution.completedAt = Date.now();
    }
  }

  /**
   * Get the current execution state
   * @returns {Object|null} Current execution state object or null if no execution
   */
  getExecution() {
    return this.currentExecution;
  }

  /**
   * Check if chain is currently running
   * @returns {boolean} True if chain is running, false otherwise
   */
  isRunning() {
    return this.currentExecution?.status === 'running';
  }

  /**
   * Execute a step with automatic retry on rate limit errors
   * Uses exponential backoff for retries
   * 
   * @param {Object} step - Step configuration object
   * @param {string} input - Processed input for this step
   * @param {Function} onChunk - Callback for streaming chunks (chunk, thinking)
   * @param {number} retryCount - Current retry attempt number
   * @returns {Promise<Object>} Step execution result
   * @throws {Error} If max retries exceeded or non-rate-limit error occurs
   */
  async executeStepWithRetry(step, input, onChunk, retryCount = 0) {
    try {
      return await this.executeStep(step, input, onChunk);
    } catch (error) {
      // Check for rate limit error
      if (error.status === 429 || error.message?.includes('rate limit')) {
        if (retryCount < MAX_RETRIES) {
          const delay = RATE_LIMIT_DELAY * Math.pow(2, retryCount);
          console.log(`Rate limited, waiting ${delay}ms before retry ${retryCount + 1}`);
          await new Promise(resolve => setTimeout(resolve, delay));
          return this.executeStepWithRetry(step, input, onChunk, retryCount + 1);
        }
      }
      throw error;
    }
  }

  /**
   * Classify an error into a specific type with user-friendly message
   * 
   * @param {Error} error - The error to classify
   * @returns {Object} Classification object with type and message properties
   * @property {string} type - Error type (rate_limit, auth, overload, timeout, unknown)
   * @property {string} message - User-friendly error message
   */
  classifyError(error) {
    if (error.status === 429 || error.message?.includes('rate limit')) {
      return { type: 'rate_limit', message: 'API rate limit reached. Please wait and try again.' };
    }
    if (error.status === 401 || error.message?.includes('unauthorized')) {
      return { type: 'auth', message: 'API authentication failed. Check your API key.' };
    }
    if (error.status === 503 || error.message?.includes('overloaded')) {
      return { type: 'overload', message: 'API is overloaded. Please try again later.' };
    }
    if (error.message?.includes('timeout')) {
      return { type: 'timeout', message: 'Request timed out. The step took too long.' };
    }
    return { type: 'unknown', message: error.message || 'An unexpected error occurred.' };
  }

  /**
   * Check if the chain is approaching context token limits
   * Warns if total tokens exceed 100k (approaching typical 128k limit)
   * 
   * @returns {boolean} True if approaching context limit, false otherwise
   */
  checkContextOverflow() {
    if (!this.currentExecution || !this.currentExecution.results) {
      return false;
    }
    
    const totalTokens = this.currentExecution.results.reduce((sum, r) => {
      return sum + (r.usage?.prompt_tokens || 0) + (r.usage?.completion_tokens || 0);
    }, 0);
    
    // Warn if approaching typical context limits (128k tokens)
    if (totalTokens > 100000) {
      console.warn('Chain approaching context limit:', totalTokens, 'tokens');
      return true;
    }
    return false;
  }
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { ChainExecutor, CHAIN_STEP_TIMEOUT, RATE_LIMIT_DELAY, MAX_RETRIES };
}

// Make available globally for browser environments
if (typeof window !== 'undefined') {
  window.ChainExecutor = ChainExecutor;
}
