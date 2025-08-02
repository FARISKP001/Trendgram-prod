function generateRoomName(userId1, userId2) {
  return [userId1, userId2].sort().join('-');
}

module.exports = { generateRoomName };
