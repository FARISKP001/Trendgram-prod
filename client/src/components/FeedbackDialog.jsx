import React, { useState } from 'react';
import { Dialog, DialogPanel } from '@headlessui/react';
import { XMarkIcon } from '@heroicons/react/24/outline';
import { toast } from 'react-hot-toast';

const FeedbackDialog = ({ isOpen, onClose }) => {
  const [feedbackText, setFeedbackText] = useState('');
  const [rating, setRating] = useState(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    
    if (!feedbackText.trim()) {
      toast.error('Please enter your feedback');
      return;
    }
    
    if (feedbackText.trim().length > 2000) {
      toast.error('Feedback is too long (max 2000 characters)');
      return;
    }
    
    setIsSubmitting(true);
    
    try {
      // Get API base URL from environment
      // In development, use the proxy (vite.config.js proxies /api to localhost:5000)
      // In production, use VITE_API_BASE_URL if set, otherwise use relative path
      let apiUrl;
      if (import.meta.env.DEV) {
        // Development: use proxy
        apiUrl = '/api/feedback';
      } else {
        // Production: use VITE_API_BASE_URL or relative path
        const baseUrl = import.meta.env.VITE_API_BASE_URL;
        if (baseUrl) {
          // Remove trailing slash if present and add /api/feedback
          apiUrl = `${baseUrl.replace(/\/+$/, '')}/api/feedback`;
        } else {
          // Fallback to relative path
          apiUrl = '/api/feedback';
        }
      }
      
      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          feedbackText: feedbackText.trim(),
          rating: rating || null,
        }),
      });
      
      // Check if response is OK before parsing JSON
      if (!response.ok) {
        let errorMessage = 'Failed to submit feedback';
        try {
          const errorData = await response.json();
          errorMessage = errorData.error || errorMessage;
        } catch (e) {
          // If response is not JSON, use status text
          errorMessage = response.statusText || errorMessage;
        }
        throw new Error(errorMessage);
      }
      
      const data = await response.json();
      
      toast.success(data.message || 'Thank you for your feedback!');
      
      // Reset form
      setFeedbackText('');
      setRating(null);
      onClose();
    } catch (error) {
      console.error('Feedback submission error:', error);
      toast.error(error.message || 'Failed to submit feedback. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleClose = () => {
    if (!isSubmitting) {
      setFeedbackText('');
      setRating(null);
      onClose();
    }
  };

  return (
    <Dialog open={isOpen} onClose={handleClose} className="relative z-50">
      {/* Backdrop */}
      <div className="fixed inset-0 bg-black/30" aria-hidden="true" />
      
      {/* Dialog container */}
      <div className="fixed inset-0 flex items-center justify-center p-4">
        <DialogPanel className="mx-auto max-w-lg w-full bg-white dark:bg-gray-800 rounded-xl shadow-xl">
          {/* Header */}
          <div className="flex items-center justify-between p-6 border-b border-gray-200 dark:border-gray-700">
            <h2 className="text-xl font-semibold text-gray-900 dark:text-white">
              Share Your Feedback
            </h2>
            <button
              onClick={handleClose}
              disabled={isSubmitting}
              className="rounded-lg p-1.5 text-gray-400 hover:text-gray-500 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-purple-500 disabled:opacity-50"
            >
              <XMarkIcon className="h-6 w-6" />
              <span className="sr-only">Close</span>
            </button>
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit} className="p-6">
            {/* Rating Section (Optional) */}
            <div className="mb-6">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                How would you rate your experience? (Optional)
              </label>
              <div className="flex gap-2">
                {[1, 2, 3, 4, 5].map((star) => (
                  <button
                    key={star}
                    type="button"
                    onClick={() => setRating(star)}
                    disabled={isSubmitting}
                    className={`flex-shrink-0 w-10 h-10 rounded-lg border-2 transition-colors focus:outline-none focus:ring-2 focus:ring-purple-500 ${
                      rating >= star
                        ? 'bg-yellow-400 border-yellow-500 text-yellow-900'
                        : 'bg-gray-100 dark:bg-gray-700 border-gray-300 dark:border-gray-600 text-gray-400 hover:border-yellow-400'
                    }`}
                  >
                    <span className="text-lg">⭐</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Feedback Text */}
            <div className="mb-6">
              <label 
                htmlFor="feedback-text"
                className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2"
              >
                Your Feedback <span className="text-red-500">*</span>
              </label>
              <textarea
                id="feedback-text"
                value={feedbackText}
                onChange={(e) => setFeedbackText(e.target.value)}
                disabled={isSubmitting}
                rows={6}
                maxLength={2000}
                placeholder="Tell us what you think... Share your suggestions, report issues, or let us know what you love!"
                className="w-full px-4 py-3 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent disabled:opacity-50 disabled:cursor-not-allowed resize-none"
                required
              />
              <div className="mt-1 text-xs text-gray-500 dark:text-gray-400 text-right">
                {feedbackText.length} / 2000 characters
              </div>
            </div>

            {/* Submit Button */}
            <div className="flex justify-end gap-3">
              <button
                type="button"
                onClick={handleClose}
                disabled={isSubmitting}
                className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600 focus:outline-none focus:ring-2 focus:ring-gray-500 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isSubmitting || !feedbackText.trim()}
                className="px-6 py-2 text-sm font-medium text-white bg-purple-600 rounded-lg hover:bg-purple-700 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {isSubmitting ? 'Submitting...' : 'Submit Feedback'}
              </button>
            </div>
          </form>
        </DialogPanel>
      </div>
    </Dialog>
  );
};

export default FeedbackDialog;

