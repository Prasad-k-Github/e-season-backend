const fs = require('fs');
const path = require('path');
const multer = require('multer');
const config = require('../config');
const { randomToken } = require('../utils/crypto');
const { bad } = require('../utils/httpError');

fs.mkdirSync(config.uploadDir, { recursive: true });

const EXT = { 'image/jpeg': '.jpg', 'image/png': '.png' };

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, config.uploadDir),
  filename: (req, file, cb) => cb(null, `${randomToken(16)}${EXT[file.mimetype] || '.bin'}`),
});

const upload = multer({
  storage,
  limits: { fileSize: config.maxUploadBytes, files: 3 },
  fileFilter: (req, file, cb) => {
    if (!EXT[file.mimetype]) return cb(bad('Only JPEG or PNG images are allowed', 'bad_file_type'));
    cb(null, true);
  },
});

// Accepts "photo" (alias "profilePhoto"), "nicFront", "nicBack".
const registrationFiles = upload.fields([
  { name: 'photo', maxCount: 1 },
  { name: 'profilePhoto', maxCount: 1 },
  { name: 'nicFront', maxCount: 1 },
  { name: 'nicBack', maxCount: 1 },
]);

/** Check the real file signature, not just the declared MIME type. */
function looksLikeImage(filePath) {
  const fd = fs.openSync(filePath, 'r');
  try {
    const buf = Buffer.alloc(8);
    fs.readSync(fd, buf, 0, 8, 0);
    const jpeg = buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
    const png = buf.equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    return jpeg || png;
  } finally {
    fs.closeSync(fd);
  }
}

/** Turn multer's req.files into { photo, nicFront, nicBack } (multer file objects or undefined). */
function pickDocs(req) {
  const f = req.files || {};
  return {
    photo: (f.photo && f.photo[0]) || (f.profilePhoto && f.profilePhoto[0]),
    nicFront: f.nicFront && f.nicFront[0],
    nicBack: f.nicBack && f.nicBack[0],
  };
}

function allUploadedFiles(req) {
  return Object.values(req.files || {}).flat();
}

function removeFile(filename) {
  if (!filename) return;
  fs.unlink(path.join(config.uploadDir, path.basename(filename)), () => {});
}

function removeUploaded(req) {
  allUploadedFiles(req).forEach((f) => removeFile(f.filename));
}

module.exports = { registrationFiles, looksLikeImage, pickDocs, removeFile, removeUploaded };
