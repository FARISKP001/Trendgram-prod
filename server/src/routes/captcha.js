module.exports = (app, redis) => {
  app.post('/api/verify-captcha', async (req, res) => {
    const { token, deviceId } = req.body || {};
    if (!token || !deviceId) return res.status(400).json({ success: false });

    try {
      const secret = process.env.CF_SECRET;
      const params = new URLSearchParams();
      params.append('secret', secret);
      params.append('response', token);

      const cfRes = await fetch(
        'https://challenges.cloudflare.com/turnstile/v0/siteverify',
        {
          method: 'POST',
          body: params,
        }
      );
      const data = await cfRes.json();
      if (data.success) {
        await redis.set(`captcha:passed:${deviceId}`, 1, 'EX', 3600);
      }
      res.json({ success: !!data.success });
    } catch (err) {
      console.error('Captcha verification failed', err);
      res.status(500).json({ success: false });
    }
  });
};