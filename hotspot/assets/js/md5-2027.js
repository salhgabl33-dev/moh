/* MD5 byte-string implementation for RouterOS HTTP-CHAP only (RFC 1321).
 * Input contains raw challenge bytes; the result is not a password store. */
(function (root) {
  "use strict";
  var shift = [7,12,17,22,7,12,17,22,7,12,17,22,7,12,17,22,
    5,9,14,20,5,9,14,20,5,9,14,20,5,9,14,20,
    4,11,16,23,4,11,16,23,4,11,16,23,4,11,16,23,
    6,10,15,21,6,10,15,21,6,10,15,21,6,10,15,21];
  var constants = Array.from({length:64}, function (_, i) {
    return Math.floor(Math.abs(Math.sin(i + 1)) * 4294967296) | 0;
  });
  root.hotspotMD5 = function (input) {
    var bytes = Array.from(input, function (c) { return c.charCodeAt(0) & 255; });
    var length = bytes.length, bits = length * 8;
    bytes.push(128);
    while (bytes.length % 64 !== 56) bytes.push(0);
    for (var z = 0; z < 8; z++) bytes.push(Math.floor(bits / Math.pow(256,z)) & 255);
    var state = [0x67452301, 0xefcdab89 | 0, 0x98badcfe | 0, 0x10325476];
    for (var offset = 0; offset < bytes.length; offset += 64) {
      var words = [];
      for (var j=0; j<16; j++) {
        var k=offset+j*4;
        words[j]=bytes[k] | bytes[k+1]<<8 | bytes[k+2]<<16 | bytes[k+3]<<24;
      }
      var a=state[0], b=state[1], c=state[2], d=state[3];
      for (var i=0; i<64; i++) {
        var f, g;
        if(i<16){ f=(b&c)|(~b&d); g=i; }
        else if(i<32){ f=(d&b)|(~d&c); g=(5*i+1)%16; }
        else if(i<48){ f=b^c^d; g=(3*i+5)%16; }
        else { f=c^(b|~d); g=(7*i)%16; }
        var sum=(a+f+constants[i]+words[g])|0;
        var oldD=d; d=c; c=b;
        b=(b+((sum<<shift[i]) | (sum>>>(32-shift[i]))))|0; a=oldD;
      }
      state=[(state[0]+a)|0,(state[1]+b)|0,(state[2]+c)|0,(state[3]+d)|0];
    }
    return state.map(function (word) {
      var result="";
      for(var i=0;i<4;i++) result+=((word>>>(8*i))&255).toString(16).padStart(2,"0");
      return result;
    }).join("");
  };
})(window);
