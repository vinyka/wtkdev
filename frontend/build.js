const { execSync } = require('child_process');

// Set environment variables
process.env.NODE_OPTIONS = '--openssl-legacy-provider --max-old-space-size=4096';
process.env.GENERATE_SOURCEMAP = 'false';

try {
  console.log('Starting React build...');
  execSync('react-scripts build', { 
    stdio: 'inherit',
    env: process.env
  });
  console.log('Build completed successfully!');
} catch (error) {
  console.error('Build failed:', error.message);
  process.exit(1);
}