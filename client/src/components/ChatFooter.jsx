import React from 'react';
import { ArrowRight, AlertTriangle } from 'lucide-react';

const ChatFooter = ({ handleNext, handleReport }) => (
  <div className="flex justify-center gap-6 py-3 mt-auto bg-white dark:bg-[#1e1e1e] border-t border-gray-200 dark:border-gray-800">
    <button
      onClick={handleNext}
      title="Next"
      aria-label="Next"
      className="flex items-center gap-2 px-6 py-2 rounded-full text-sm font-semibold text-white bg-blue-500 hover:bg-blue-600 transition-transform transform shadow-md hover:brightness-110"
    >
      <ArrowRight className="w-5 h-5" />
      Next
    </button>

    <button
      onClick={handleReport}
      title="Report"
      aria-label="Report"
      className="flex items-center gap-2 px-6 py-2 rounded-full text-sm font-semibold text-white bg-red-500 hover:bg-red-600 transition-transform transform active:scale-95 shadow-md"
    >
      <AlertTriangle className="w-5 h-5" />
      Report
    </button>
  </div>
);

export default ChatFooter;