module.exports =
function convertToProtobufCompatibleBuffer (data) {
  if (data == null) return data

  if (!(data instanceof Buffer)) {
    data = Buffer.from(data)
  }
  // Hack to convince protocol buffers that this Buffer really *is* a Uint8Array
  data.constructor = Uint8Array
  return data
}
