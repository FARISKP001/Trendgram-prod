import React, { useEffect } from 'react';
import { Send } from 'lucide-react';

const MAX_LINES = 3;

const ChatInput = ({
  input,
  inputError,
  chatState,
  handleInputChange,
  handleSend,
  inputRef,
}) => {
  const autoResize = () => {
    const el = inputRef?.current;
    if (!el) return;
    const cs = window.getComputedStyle(el);
    const lineHeight = parseFloat(cs.lineHeight) || 22;
    const padY =
      parseFloat(cs.paddingTop || '0') + parseFloat(cs.paddingBottom || '0');
    const borderY =
      parseFloat(cs.borderTopWidth || '0') + parseFloat(cs.borderBottomWidth || '0');
    const maxH = MAX_LINES * lineHeight + padY + borderY;

    el.style.height = 'auto';
    const newH = Math.min(el.scrollHeight, maxH);
    el.style.height = `${newH}px`;
    el.style.overflowY = el.scrollHeight > maxH ? 'auto' : 'hidden';
  };

  useEffect(() => { autoResize(); }, []);
  useEffect(() => { autoResize(); }, [input]);

  const onKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (!input.trim() || inputError || chatState === 'disconnected') return;
      handleSend();
    }
  };

  if (!(chatState === 'chatting' || chatState === 'disconnected')) return null;

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        handleSend();
      }}
      className="w-full bg-inherit p-4"
    >
      <div className="flex items-end gap-2">
        {/* Input pill */}
        <div className="flex-1 rounded-2xl border border-black dark:border-gray-500 bg-white dark:bg-gray-800 shadow-md px-3 py-1">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => {
              handleInputChange(e);
              autoResize();
            }}
            onKeyDown={onKeyDown}
            rows={1}
            placeholder="Type a message..."
            required
            autoFocus
            disabled={chatState === 'disconnected'}
            className="
              block w-full bg-transparent outline-none
              text-[15px] leading-[20px]
              text-gray-900 dark:text-gray-100
              placeholder:text-gray-500 dark:placeholder:text-gray-400
              caret-sky-500
              resize-none
              min-h-[36px] max-h-[96px]
              overflow-y-hidden
            "
            style={{ height: '36px' }}
          />
        </div>

        {/* Send button */}
        <button
          type="submit"
          disabled={!input.trim() || !!inputError || chatState === 'disconnected'}
          className="
            shrink-0 rounded-full flex items-center justify-center
            w-11 h-11
            bg-green-500 text-white
            border border-black dark:border-gray-500
            shadow-[0_0_8px_rgba(34,197,94,0.7)]
            hover:bg-green-600
            disabled:opacity-40 disabled:cursor-not-allowed
          "
          tabIndex={input.trim() && chatState !== 'disconnected' ? 0 : -1}
          aria-label="Send"
        >
          <Send className="w-[18px] h-[18px] rotate-[12deg]" />
        </button>
      </div>

      {inputError && (
        <div className="text-red-500 text-xs mt-1 px-1">{inputError}</div>
      )}
    </form>
  );
};

export default ChatInput;
