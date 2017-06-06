require('dotenv').config()

process.on('unhandledRejection', (reason) => {
  console.error(reason.stack)
})
