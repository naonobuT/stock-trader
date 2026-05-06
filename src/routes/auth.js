const express = require('express');
const bcrypt = require('bcryptjs');
const { getDb } = require('../db');

const router = express.Router();

router.post('/register', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'ユーザー名とパスワードを入力してください' });
  if (username.length < 2 || username.length > 20) return res.status(400).json({ error: 'ユーザー名は2〜20文字で入力してください' });
  if (password.length < 4) return res.status(400).json({ error: 'パスワードは4文字以上で入力してください' });

  const hash = await bcrypt.hash(password, 10);
  const db = getDb();

  try {
    const result = db.prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)').run(username, hash);
    req.session.userId = result.lastInsertRowid;
    req.session.username = username;
    res.json({ success: true, username });
  } catch (err) {
    if (err.message.includes('UNIQUE')) return res.status(409).json({ error: 'そのユーザー名はすでに使われています' });
    res.status(500).json({ error: 'サーバーエラー' });
  }
});

router.post('/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'ユーザー名とパスワードを入力してください' });

  const db = getDb();
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!user) return res.status(401).json({ error: 'ユーザー名またはパスワードが違います' });

  const ok = await bcrypt.compare(password, user.password_hash);
  if (!ok) return res.status(401).json({ error: 'ユーザー名またはパスワードが違います' });

  req.session.userId = user.id;
  req.session.username = user.username;
  res.json({ success: true, username: user.username });
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => res.json({ success: true }));
});

router.get('/me', (req, res) => {
  if (!req.session.userId) return res.json({ loggedIn: false });
  const db = getDb();
  const user = db.prepare('SELECT id, username, virtual_cash FROM users WHERE id = ?').get(req.session.userId);
  res.json({ loggedIn: true, ...user });
});

module.exports = router;
