import React from 'react';
import { Send } from 'lucide-react';

const ChatInput = ({
  input,
  inputError,
  chatState,
  handleInputChange,
  handleSend,
  showEmojiPicker,
  setShowEmojiPicker,
  inputRef,
}) => (
  <>
    {(chatState === 'chatting' || chatState === 'disconnected') && (
      <form
        onSubmit={(e) => {
          e.preventDefault();
          handleSend();
        }}
        className="w-full bg-inherit p-3"
      >
        <div className="flex items-center w-full h-12 border border-[#ece5dd] rounded-lg bg-white dark:bg-gray-700 px-3 shadow-sm">
          <button
            type="button"
            onClick={() => setShowEmojiPicker(!showEmojiPicker)}
            className="text-xl px-1 emoji-btn"
            aria-label="Open Emoji Picker"
            disabled={chatState === 'disconnected'}
          >
            😊
          </button>
          <input
            ref={inputRef}
            value={input}
            onChange={handleInputChange}
            className="flex-1 px-3 h-full bg-transparent outline-none rounded-md"
            placeholder="Type a message..."
            required
            autoFocus
            disabled={chatState === 'disconnected'}
          />
          <button
            type="submit"
            disabled={!input.trim() || !!inputError || chatState === 'disconnected'}
            className={`ml-2 px-4 py-2 bg-green-500 text-white rounded-full flex items-center gap-2 text-base font-semibold transition disabled:opacity-40 disabled:cursor-not-allowed shadow-[0_0_10px_#22c55e] hover:bg-green-600 hover:text-white disabled:hover:bg-green-500 disabled:hover:text-white`}
            tabIndex={input.trim() && chatState !== 'disconnected' ? 0 : -1}
          >
            <Send className="w-4 h-4" />
            Send
          </button>
        </div>
        {inputError && <div className="text-red-500 text-xs mt-1 px-4">{inputError}</div>}
      </form>
    )}
  </>
);

export default ChatInput;