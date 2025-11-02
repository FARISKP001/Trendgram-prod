local queueKey = KEYS[1]
local userId = ARGV[1]
local ttl = ARGV[2]

-- Ensure user doesn't already have a partner (enforce one partner at a time)
if redis.call('EXISTS', 'paired:' .. userId) == 1 then
    return nil
end

local partnerId = redis.call('LPOP', queueKey)
if not partnerId then
    return nil
end

if partnerId == userId then
    return nil
end

-- Ensure partner doesn't already have a partner (enforce one partner at a time)
if redis.call('EXISTS', 'paired:' .. partnerId) == 1 then
    -- Put partnerId back in queue since they're already paired
    redis.call('RPUSH', queueKey, partnerId)
    return nil
end

local roomName = (userId < partnerId) and (userId .. '-' .. partnerId) or (partnerId .. '-' .. userId)
redis.call('SET', 'paired:' .. userId, roomName, 'EX', ttl)
redis.call('SET', 'paired:' .. partnerId, roomName, 'EX', ttl)

return partnerId
