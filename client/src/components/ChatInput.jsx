import React from 'react';
import { Send } from 'lucide-react';

const ChatInput = ({
  input,
  inputError,
  chatState,
  handleInputChange,
  handleSend,
  inputRef,
}) => (
  <>
    {(chatState === 'chatting' || chatState === 'disconnected') && (
      <form
        onSubmit={(e) => {
          e.preventDefault();
          handleSend();
        }}
        className="w-full bg-inherit p-4"
      >
        <div className="flex items-center w-full h-16 border border-[#ece5dd] rounded-xl bg-white dark:bg-gray-700 px-4 shadow-md">
          
          <textarea
            ref={inputRef}
            value={input}
            onChange={handleInputChange}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                if (!input.trim() || inputError || chatState === 'disconnected') return;
                handleSend();
              }
            }}
            className="flex-1 px-4 py-2 h-full bg-transparent outline-none rounded-md text-lg resize-none overflow-y-auto whitespace-pre-wrap"
            placeholder="Type a message..."
            required
            autoFocus
            disabled={chatState === 'disconnected'}
            style={{ minHeight: 40 }}
            rows={1}
          />
          <button
            type="submit"
            disabled={!input.trim() || !!inputError || chatState === 'disconnected'}
            className={`ml-3 px-5 py-3 bg-green-500 text-white rounded-full flex items-center gap-2 text-base font-semibold transition disabled:opacity-40 disabled:cursor-not-allowed shadow-[0_0_10px_#22c55e] hover:bg-green-600 hover:text-white disabled:hover:bg-green-500 disabled:hover:text-white`}
            tabIndex={input.trim() && chatState !== 'disconnected' ? 0 : -1}
            style={{ minHeight: 40 }}
          >
            <Send className="w-5 h-5" />
            Send
          </button>
        </div>
        {inputError && <div className="text-red-500 text-xs mt-1 px-4">{inputError}</div>}
      </form>
    )}
  </>
);

export default ChatInput;
