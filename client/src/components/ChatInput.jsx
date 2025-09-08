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
        {/* Container */}
        <div className="flex items-center w-full h-16 border border-[#ece5dd] rounded-xl bg-white dark:bg-gray-700 px-3 shadow-md">
          {/* Single-line textarea (horizontal scroll, no wrap, no vertical growth) */}
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => {
              // strip newlines so it always stays one line
              if (e.target.value.includes('\n')) {
                e.target.value = e.target.value.replace(/\r?\n/g, ' ');
              }
              handleInputChange(e);
            }}
            onKeyDown={(e) => {
              // prevent Shift+Enter from creating a newline
              if (e.key === 'Enter') {
                e.preventDefault();
                if (!input.trim() || inputError || chatState === 'disconnected') return;
                handleSend();
              }
            }}
            className="
              flex-1 px-3 bg-transparent outline-none rounded-sm text-base
              resize-none
              h-12 max-h-12
              overflow-y-hidden overflow-x-auto
              whitespace-nowrap
            "
            placeholder="Type a message..."
            required
            autoFocus
            disabled={chatState === 'disconnected'}
            rows={1}
            wrap="off"
            style={{ minHeight: 0 }}
          />

          {/* Bigger Send button (mobile-friendly) */}
          <button
            type="submit"
            disabled={!input.trim() || !!inputError || chatState === 'disconnected'}
            className="
              ml-3 rounded-full flex items-center justify-center
              w-12 h-12 md:w-11 md:h-11
              bg-green-500 text-white
              transition shadow-[0_0_10px_#22c55e]
              hover:bg-green-600 disabled:opacity-40 disabled:cursor-not-allowed
            "
            tabIndex={input.trim() && chatState !== 'disconnected' ? 0 : -1}
          >
            <Send className="w-6 h-6 md:w-5 md:h-5" />
          </button>
        </div>

        {inputError && <div className="text-red-500 text-xs mt-1 px-1">{inputError}</div>}
      </form>
    )}
  </>
);

export default ChatInput;
