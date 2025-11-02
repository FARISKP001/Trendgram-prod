import React, { useState, useEffect, useRef } from 'react';
import { Dialog, DialogPanel } from '@headlessui/react';
import { XMarkIcon, ChevronRightIcon, QuestionMarkCircleIcon } from '@heroicons/react/24/outline';
import { toast } from 'react-toastify';

const FAQAssistant = ({ isOpen, onClose }) => {
  const [faqs, setFaqs] = useState([]);
  const [filteredFaqs, setFilteredFaqs] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [expandedIds, setExpandedIds] = useState(new Set());
  const [activeTab, setActiveTab] = useState('faqs');
  const scrollContainerRef = useRef(null);

  // Feedback state
  const [feedbackText, setFeedbackText] = useState('');
  const [rating, setRating] = useState(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Categories for filtering
  const categories = [
    { id: 'all', name: 'All FAQs', count: 0 },
    { id: 'general', name: 'General', count: 0 },
    { id: 'account', name: 'Account', count: 0 },
    { id: 'safety', name: 'Safety', count: 0 },
    { id: 'features', name: 'Features', count: 0 },
    { id: 'support', name: 'Support', count: 0 },
  ];
  const [activeCategory, setActiveCategory] = useState('all');

  // Fetch FAQs from API
  const fetchFAQs = async () => {
    setIsLoading(true);
    try {
      let apiUrl;
      if (import.meta.env.DEV) {
        apiUrl = '/api/faqs';
      } else {
        const baseUrl = import.meta.env.VITE_API_BASE_URL;
        apiUrl = baseUrl ? `${baseUrl.replace(/\/+$/, '')}/api/faqs` : '/api/faqs';
      }

      const response = await fetch(apiUrl, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        throw new Error('Failed to fetch FAQs');
      }

      const data = await response.json();
      setFaqs(data.faqs || []);
      setFilteredFaqs(data.faqs || []);
    } catch (error) {
      console.error('Fetch FAQs error:', error);
      toast.error('Failed to load FAQs. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  // Load FAQs when dialog opens
  useEffect(() => {
    if (isOpen && activeTab === 'faqs') {
      fetchFAQs();
    }
  }, [isOpen, activeTab]);

  // Filter FAQs based on category
  useEffect(() => {
    let filtered = [...faqs];

    // Apply category filter
    if (activeCategory !== 'all') {
      filtered = filtered.filter((faq) => faq.category === activeCategory);
    }

    setFilteredFaqs(filtered);
  }, [faqs, activeCategory]);

  // Toggle FAQ expansion
  const toggleFAQ = (faqId) => {
    const newExpanded = new Set(expandedIds);
    if (newExpanded.has(faqId)) {
      newExpanded.delete(faqId);
    } else {
      newExpanded.add(faqId);
    }
    setExpandedIds(newExpanded);
  };

  // Handle feedback submission
  const handleFeedbackSubmit = async (e) => {
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
      let apiUrl;
      if (import.meta.env.DEV) {
        apiUrl = '/api/feedback';
      } else {
        const baseUrl = import.meta.env.VITE_API_BASE_URL;
        apiUrl = baseUrl ? `${baseUrl.replace(/\/+$/, '')}/api/feedback` : '/api/feedback';
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
      
      if (!response.ok) {
        let errorMessage = 'Failed to submit feedback';
        try {
          const errorData = await response.json();
          errorMessage = errorData.error || errorMessage;
        } catch (e) {
          errorMessage = response.statusText || errorMessage;
        }
        throw new Error(errorMessage);
      }
      
      const data = await response.json();
      
      toast.success(data.message || 'Thank you for your feedback!');
      
      // Reset form
      setFeedbackText('');
      setRating(null);
    } catch (error) {
      console.error('Feedback submission error:', error);
      toast.error(error.message || 'Failed to submit feedback. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Handle close
  const handleClose = () => {
    setExpandedIds(new Set());
    setActiveCategory('all');
    setActiveTab('faqs');
    setFeedbackText('');
    setRating(null);
    onClose();
  };

  // Calculate category counts
  const categoryCounts = React.useMemo(() => {
    const counts = {};
    faqs.forEach((faq) => {
      counts[faq.category] = (counts[faq.category] || 0) + 1;
    });
    return counts;
  }, [faqs]);

  const getTabIcon = (tabId, isActive) => {
    const iconClassName = isActive ? "w-5 h-5 text-white" : "w-5 h-5 text-gray-600";
    
    switch(tabId) {
      case 'faqs':
        return <QuestionMarkCircleIcon className={iconClassName} />;
      case 'feedback':
        return <span className="text-2xl">{'💬'}</span>;
      case 'contact':
        return <span className="text-2xl">{'📞'}</span>;
      default:
        return null;
    }
  };

  const tabs = ['faqs', 'feedback', 'contact'];

  return (
    <Dialog open={isOpen} onClose={handleClose} className="relative z-50">
      {/* Backdrop */}
      <div className="fixed inset-0 bg-black/50" aria-hidden="true" />

      {/* Dialog container - positioned on the right side */}
      <div className="fixed inset-0 flex justify-end p-0">
        <DialogPanel className="absolute w-full md:w-[32%] min-w-[320px] md:min-w-[380px] max-w-[420px] top-[20px] md:top-[70px] bottom-[100px] md:bottom-[88px] right-2 md:right-6 flex flex-col bg-white shadow-2xl overflow-hidden rounded-2xl md:rounded-3xl">
          {/* Header Section */}
          <div className="relative bg-white px-4 md:px-8 pt-4 md:pt-6 pb-3 md:pb-4 border-b border-gray-200">
            {/* Top bar with close button */}
            <div className="flex items-center justify-end mb-4">
              <button
                onClick={handleClose}
                className="rounded-full p-2 hover:bg-purple-50 focus:outline-none focus:ring-2 focus:ring-purple-500 transition-colors"
              >
                <XMarkIcon className="h-5 w-5 text-purple-600" />
                <span className="sr-only">Close</span>
              </button>
            </div>

            {/* Greeting */}
            <h2 className="text-2xl md:text-3xl font-bold text-gray-900 mb-2">
              Hello ! How can we help?
            </h2>
          </div>

          {/* Tabs */}
          <div className="px-4 md:px-8 py-3 md:py-4 border-b border-gray-200 bg-gray-50">
            <div className="flex gap-2 md:gap-6 justify-between overflow-x-auto">
              {tabs.map((tabId) => (
                <button
                  key={tabId}
                  onClick={() => setActiveTab(tabId)}
                  className={`px-3 md:px-6 py-2 md:py-3 text-sm font-semibold whitespace-nowrap rounded-lg transition-all ${
                    activeTab === tabId
                      ? 'bg-purple-600 text-white shadow-md'
                      : 'text-gray-600 hover:bg-gray-100'
                  }`}
                >
                  {getTabIcon(tabId, activeTab === tabId)}
                </button>
              ))}
            </div>
          </div>

          {/* Category Filter Pills (only for FAQs tab) */}
          {activeTab === 'faqs' && (
            <div className="px-4 md:px-8 py-3 md:py-4 border-b border-gray-200 bg-gray-50">
              <div className="flex flex-wrap gap-2">
                {categories.map((cat) => {
                  const count = cat.id === 'all' ? faqs.length : categoryCounts[cat.id] || 0;
                  if (count === 0 && cat.id !== 'all') return null;
                  
                  return (
                    <button
                      key={cat.id}
                      onClick={() => setActiveCategory(cat.id)}
                      className={`px-3 py-1.5 text-xs font-semibold rounded-full transition-all ${
                        activeCategory === cat.id
                          ? 'bg-purple-600 text-white shadow-md'
                          : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                      }`}
                    >
                      {cat.name}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Content Area */}
          <div
            ref={scrollContainerRef}
            className="flex-1 overflow-y-auto px-4 md:px-8 py-4 md:py-6 space-y-3 bg-white"
          >
            {activeTab === 'faqs' && (
              <>
                {isLoading ? (
                  <div className="flex items-center justify-center h-full">
                    <div className="text-center">
                      <div className="inline-block animate-spin rounded-full h-10 w-10 border-3 border-purple-600 border-t-transparent"></div>
                      <p className="mt-4 text-gray-700 font-medium">
                        Loading FAQs...
                      </p>
                    </div>
                  </div>
                ) : filteredFaqs.length === 0 ? (
                  <div className="flex items-center justify-center h-full">
                    <div className="text-center">
                      <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-gray-100 flex items-center justify-center">
                        <svg
                          className="w-8 h-8 text-gray-400"
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                          />
                        </svg>
                      </div>
                      <h3 className="text-lg font-semibold text-gray-900 mb-1">
                        No FAQs found
                      </h3>
                      <p className="text-sm text-gray-600">
                        No FAQs available at the moment
                      </p>
                    </div>
                  </div>
                ) : (
                  filteredFaqs.map((faq) => {
                    const isExpanded = expandedIds.has(faq._id);
                    return (
                      <div
                        key={faq._id}
                        className="bg-white rounded-2xl overflow-hidden transition-all hover:shadow-lg"
                      >
                        <button
                          onClick={() => toggleFAQ(faq._id)}
                          className="w-full px-4 md:px-6 py-3 md:py-4 flex items-center justify-between text-left hover:bg-gray-50 transition-colors"
                        >
                          <span className="flex-1 pr-2 md:pr-4 text-sm md:text-base font-medium text-gray-900">
                            {faq.question}
                          </span>
                          <div className={`flex-shrink-0 transition-transform ${isExpanded ? 'rotate-90' : ''}`}>
                            <ChevronRightIcon className="h-4 w-4 md:h-5 md:w-5 text-gray-500" />
                          </div>
                        </button>
                        
                        {/* Expanded Content */}
                        {isExpanded && (
                          <div className="px-4 md:px-6 pb-4 md:pb-5 border-t border-gray-100 bg-gray-50">
                            <p className="pt-3 md:pt-4 text-xs md:text-sm leading-relaxed text-gray-700 whitespace-pre-wrap">
                              {faq.answer}
                            </p>
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
              </>
            )}

            {activeTab === 'feedback' && (
              <form onSubmit={handleFeedbackSubmit} className="space-y-6">
                {/* Rating Section */}
                <div>
                  <label className="block text-sm font-semibold text-gray-900 mb-3">
                    How would you rate your experience? (Optional)
                  </label>
                  <div className="flex gap-2">
                    {[1, 2, 3, 4, 5].map((star) => (
                      <button
                        key={star}
                        type="button"
                        onClick={() => setRating(star)}
                        disabled={isSubmitting}
                        className={`flex-shrink-0 w-12 h-12 rounded-xl border-2 transition-all focus:outline-none focus:ring-2 focus:ring-yellow-400 ${
                          rating >= star
                            ? 'bg-yellow-400 border-yellow-500 scale-110'
                            : 'bg-gray-100 border-gray-300 text-gray-600 hover:border-yellow-400 hover:bg-yellow-50'
                        }`}
                      >
                        <span className="text-xl">⭐</span>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Feedback Text */}
                <div>
                  <label 
                    htmlFor="feedback-text"
                    className="block text-sm font-semibold text-gray-900 mb-3"
                  >
                    Your Feedback <span className="text-red-500">*</span>
                  </label>
                  <textarea
                    id="feedback-text"
                    value={feedbackText}
                    onChange={(e) => setFeedbackText(e.target.value)}
                    disabled={isSubmitting}
                    rows={8}
                    maxLength={2000}
                    placeholder="Tell us what you think... Share your suggestions, report issues, or let us know what you love!"
                    className="w-full px-4 py-3 bg-gray-50 border border-gray-300 rounded-2xl text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-purple-500 disabled:opacity-50 disabled:cursor-not-allowed resize-none"
                    required
                  />
                  <div className="mt-2 text-xs text-gray-500 text-right">
                    {feedbackText.length} / 2000 characters
                  </div>
                </div>

                {/* Submit Button */}
                <div className="flex justify-end pt-2">
                  <button
                    type="submit"
                    disabled={isSubmitting || !feedbackText.trim()}
                    className="px-8 py-3 text-sm font-semibold text-white bg-purple-600 rounded-xl hover:bg-purple-700 focus:outline-none focus:ring-2 focus:ring-purple-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors shadow-lg"
                  >
                    {isSubmitting ? 'Submitting...' : 'Submit Feedback'}
                  </button>
                </div>
              </form>
            )}

            {activeTab === 'contact' && (
              <div className="space-y-6">
                <div className="bg-white rounded-2xl p-6">
                  <h3 className="text-lg font-bold text-gray-900 mb-4">Get in Touch</h3>
                  <p className="text-gray-700 mb-6">
                    We're here to help! Reach out to us through any of the following channels.
                  </p>
                  
                  <div className="space-y-4">
                    <div className="flex items-start gap-3">
                      <div className="w-10 h-10 rounded-full bg-purple-100 flex items-center justify-center flex-shrink-0">
                        <svg className="w-5 h-5 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                        </svg>
                      </div>
                      <div>
                        <p className="font-semibold text-gray-900">Email</p>
                        <a href={`mailto:${import.meta.env.VITE_CONTACT_EMAIL || 'support@example.com'}`} className="text-purple-600 hover:text-purple-700">
                          {import.meta.env.VITE_CONTACT_EMAIL || 'support@example.com'}
                        </a>
                      </div>
                    </div>

                    <div className="flex items-start gap-3">
                      <div className="w-10 h-10 rounded-full bg-purple-100 flex items-center justify-center flex-shrink-0">
                        <svg className="w-5 h-5 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                        </svg>
                      </div>
                      <div>
                        <p className="font-semibold text-gray-900">Live Support</p>
                        <p className="text-gray-600">Available 24/7</p>
                      </div>
                    </div>

                    <div className="flex items-start gap-3">
                      <div className="w-10 h-10 rounded-full bg-purple-100 flex items-center justify-center flex-shrink-0">
                        <svg className="w-5 h-5 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                      </div>
                      <div>
                        <p className="font-semibold text-gray-900">Response Time</p>
                        <p className="text-gray-600">Typically within 24 hours</p>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="bg-white rounded-2xl p-6">
                  <h3 className="text-lg font-bold text-gray-900 mb-4">Follow Us</h3>
                  <div className="flex gap-3">
                    <a href={import.meta.env.VITE_INSTAGRAM_URL || '#'} target="_blank" rel="noopener noreferrer" className="w-12 h-12 rounded-full bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center hover:scale-110 transition-transform">
                      <svg className="w-6 h-6 text-white" fill="currentColor" viewBox="0 0 24 24">
                        <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838c-3.403 0-6.162 2.759-6.162 6.162s2.759 6.163 6.162 6.163 6.162-2.759 6.162-6.163c0-3.403-2.759-6.162-6.162-6.162zm0 10.162c-2.209 0-4-1.79-4-4 0-2.209 1.791-4 4-4s4 1.791 4 4c0 2.21-1.791 4-4 4zm6.406-11.845c-.796 0-1.441.645-1.441 1.44s.645 1.44 1.441 1.44c.795 0 1.439-.645 1.439-1.44s-.644-1.44-1.439-1.44z"/>
                      </svg>
                    </a>
                    <a href={import.meta.env.VITE_X_URL || '#'} target="_blank" rel="noopener noreferrer" className="w-12 h-12 rounded-full bg-black flex items-center justify-center hover:scale-110 transition-transform">
                      <svg className="w-6 h-6 text-white" fill="currentColor" viewBox="0 0 24 24">
                        <path d="M18.901 1.153h3.68l-8.04 9.19L24 22.846h-7.406l-5.8-7.584-6.638 7.584H.474l8.6-9.83L0 1.154h7.594l5.243 6.932ZM17.61 20.644h2.039L6.486 3.24H4.298Z"/>
                      </svg>
                    </a>
                    <a href={import.meta.env.VITE_FACEBOOK_URL || '#'} target="_blank" rel="noopener noreferrer" className="w-12 h-12 rounded-full bg-blue-600 flex items-center justify-center hover:scale-110 transition-transform">
                      <svg className="w-6 h-6 text-white" fill="currentColor" viewBox="0 0 24 24">
                        <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/>
                      </svg>
                    </a>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="px-4 md:px-8 py-3 md:py-4 bg-white rounded-tl-2xl md:rounded-tl-3xl">
            <p className="text-center text-sm text-gray-600">
              {activeTab === 'faqs' && "Still need help? Check out our "}
              {activeTab === 'faqs' && (
                <button
                  onClick={() => setActiveTab('feedback')}
                  className="text-purple-600 hover:text-purple-700 font-semibold underline-offset-2 hover:underline"
                >
                  Feedback
                </button>
              )}
              {activeTab === 'faqs' && " or "}
              {activeTab === 'faqs' && (
                <button
                  onClick={() => setActiveTab('contact')}
                  className="text-purple-600 hover:text-purple-700 font-semibold underline-offset-2 hover:underline"
                >
                  Contact Us
                </button>
              )}
              {activeTab !== 'faqs' && (
                <>
                  Need quick answers? Check our{' '}
                  <button
                    onClick={() => setActiveTab('faqs')}
                    className="text-purple-600 hover:text-purple-700 font-semibold underline-offset-2 hover:underline"
                  >
                    FAQ section
                  </button>
                </>
              )}
            </p>
          </div>
        </DialogPanel>
      </div>
    </Dialog>
  );
};

export default FAQAssistant;
