const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, '..', 'node_modules', '@so-ric', 'colorspace', 'dist', 'index.cjs.js');

let content = fs.readFileSync(filePath, 'utf8');
const original = content;
content = content.replace(
  /\((\w+)\[(\w+)\]\s*\|\|=\s*\[\]\)/g,
  '($1[$2] || ($1[$2] = []))'
);

if (content !== original) {
  fs.writeFileSync(filePath, content, 'utf8');
  console.log('patched @so-ric/colorspace/dist/index.cjs.js');
} else {
  console.log('no patch needed');
}
