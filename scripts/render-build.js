if (process.env.RENDER || process.env.CI) {
  require('child_process').execSync('npm run build', { stdio: 'inherit' })
}
