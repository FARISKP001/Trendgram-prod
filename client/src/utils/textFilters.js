const bannedWords = [
    'fuck',
    'shit',
    'bitch',
    'asshole',
    'bastard',
    'dick',
    'pussy',
    'pooran',
    'poori',
    'thayoli',
    'punda',
    'punde',
    'myre',
    'myran',
    'maire',
    'mairen',
    'mairan',
    'kunne',
    'vedichi',
    'vedi',
    'koothi',
    'बहनचोद',
    'बेहेनचोद',
    'भेनचोद',
    'b.c.',
    'bc',
    'bahenchod',
    'bhenchod',
    'bevakoof',
    'bevkoof',
    'bevkuf',
    'bsdk',
    'b.s.d.k',
    'gandfat',
    'गंडफट',
    'gandfut',
    'harami',
    'हरामी',
    'मादरचोद',
    'madarchod',
    'madarchut',
    'madarchoot',
    'मादरचूत',
    'm.c.',
    'mc',
    'പൂറൻ',
    'പൂറി',
    'തായോളി',
    'പൂണ്ട',
    'പൂണ്ടെ',
    'മൈരെ',
    'മൈരാ',
    'മൈരൻ',
    'കുണ്ണെ',
    'വെടി'
];

const urlRegex = /(https?:\/\/[^\s]+)|(www\.[^\s]+)|([a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/i;

export const containsBadWords = (text = '') => {
  const lower = text.toLowerCase();
  return bannedWords.some((word) => lower.includes(word));
};

export const containsUrl = (text = '') => urlRegex.test(text);

// Allow only English, Hindi, and Malayalam characters (plus numbers, punctuation, spaces, symbols, emojis)
export const isAllowedLanguage = (text = '') => {
  return /^[\p{sc=Latin}\p{sc=Devanagari}\p{sc=Malayalam}\p{N}\p{P}\p{Z}\p{S}\p{M}\p{Emoji_Presentation}]*$/u.test(text);
};

export const sanitizeMessage = (text = '') => {
  let result = text;
  result = result.replace(urlRegex, '[link removed]');
  bannedWords.forEach((word) => {
    const regex = new RegExp(word, 'gi');
    result = result.replace(regex, '*'.repeat(word.length));
  });
  return result;
};

export const validateText = (text = '') => {
  if (!isAllowedLanguage(text)) {
    return { valid: false, reason: 'invalid_language' };
  }
  if (containsUrl(text)) {
    return { valid: false, reason: 'url_not_allowed' };
  }
  if (containsBadWords(text)) {
    return { valid: false, reason: 'profanity_not_allowed' };
  }
  return { valid: true };
};