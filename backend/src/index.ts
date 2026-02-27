// Validate env before anything else — crash fast on missing vars
import './config/env';
import './server';

// Import the queue worker to start processing jobs
// Worker is registered when this module loads
import './services/queue/worker';
