import React from 'react';
import { ArrowRight, AlertTriangle } from 'lucide-react';

const ChatFooter = ({ handleNext, handleReport, theme = 'light', nextDisabled = false }) => (
  <div className={`w-full flex justify-center gap-4 py-3 ${theme === 'dark' ? 'bg-[#1e1e1e] border-gray-800' : 'bg-white border-gray-200'} border-t`}>
    <button
      onClick={handleNext}
      disabled={nextDisabled}
      title={nextDisabled ? "Please wait..." : "Next"}
      aria-label="Next"
      className={`flex items-center gap-2 px-6 py-2 rounded-full text-sm font-semibold text-white transition-transform transform shadow-md ${
        nextDisabled 
          ? 'bg-gray-400 cursor-not-allowed opacity-60' 
          : 'bg-blue-500 hover:bg-blue-600 hover:brightness-110 active:scale-95'
      }`}
    >
      <ArrowRight className="w-5 h-5" />
      {nextDisabled ? 'Searching...' : 'Next'}
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