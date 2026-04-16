window.ZLIB = {};

window.ZLIB.gzip64 = (str) => {
  const compressedUint8Array = window.pako.deflate(str);
  const binaryString = String.fromCharCode.apply(null, compressedUint8Array);
  const base64String = btoa(binaryString);
  return base64String;
}

window.ZLIB.ungzip64 = (base64String) => {
  const decodedBinaryString = atob(base64String);
  const decodedUint8Array = new Uint8Array(decodedBinaryString.split('').map(char => char.charCodeAt(0)));
  const decompressedText = window.pako.inflate(decodedUint8Array, { to: 'string' });
  return decompressedText;
}