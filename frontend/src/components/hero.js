import React, { useState } from 'react';

const Hero = () => {
  const [message, setMessage] = useState('');
  const [chatHistory, setChatHistory] = useState([]);

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!message.trim()) return;

    // إضافة رسالة المستخدم إلى المحادثة
    const newMessage = {
      text: message,
      isUser: true,
      timestamp: new Date().toISOString()
    };

    setChatHistory(prev => [...prev, newMessage]);
    
    // هنا يمكن إضافة المنطق الخاص بإرسال الرسالة إلى الخادم
    // وإضافة رد النظام

    setMessage('');
  };

  return (
    <div className="main-content">
      <h1>المساعد الذكي</h1>
      
      <div className="chat-container">
        <div className="chat-messages">
          {chatHistory.map((msg, index) => (
            <div 
              key={index} 
              className={`chat-message ${msg.isUser ? 'user' : ''}`}
            >
              {msg.text}
            </div>
          ))}
        </div>

        <form onSubmit={handleSubmit} className="input-container">
          <input
            type="text"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="اكتب رسالتك هنا..."
            aria-label="رسالة المحادثة"
          />
          <button type="submit">
            إرسال
          </button>
        </form>
      </div>
    </div>
  );
};

export default Hero;
