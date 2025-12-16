// server.js - Hugging Face DeepSeek R1 Proxy
const express = require('express');
const cors = require('cors');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Hugging Face configuration
const HF_API_KEY = process.env.HF_API_KEY;
const HF_MODEL = 'deepseek-ai/DeepSeek-R1-0528';
const HF_API_URL = `https://router.huggingface.cc/models/${HF_MODEL}`;

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    service: 'Hugging Face DeepSeek R1 Proxy',
    model: HF_MODEL
  });
});

// List models endpoint
app.get('/v1/models', (req, res) => {
  res.json({
    object: 'list',
    data: [{ id: 'deepseek-r1', object: 'model', created: Date.now(), owned_by: 'hf' }]
  });
});

// Helper function
function messagesToPrompt(messages) {
  let prompt = '';
  for (const msg of messages) {
    if (msg.role === 'system') prompt += `System: ${msg.content}\n\n`;
    else if (msg.role === 'user') prompt += `User: ${msg.content}\n\n`;
    else if (msg.role === 'assistant') prompt += `Assistant: ${msg.content}\n\n`;
  }
  prompt += 'Assistant:';
  return prompt;
}

// Main chat endpoint - ALL POSSIBLE ROUTES
app.post('/v1/chat/completions', handleChat);
app.post('/chat/completions', handleChat);

async function handleChat(req, res) {
  console.log('=== RECEIVED REQUEST ===');
  console.log('Path:', req.path);
  console.log('Body:', JSON.stringify(req.body, null, 2));
  
  try {
    const { messages, max_tokens = 1024 } = req.body;
    
    if (!HF_API_KEY) {
      return res.status(500).json({ error: { message: 'HF_API_KEY not set' } });
    }

    const prompt = messagesToPrompt(messages);
    
    console.log('Calling Hugging Face DeepSeek R1...');
    const response = await axios.post(HF_API_URL, {
      inputs: prompt,
      parameters: {
        max_new_tokens: max_tokens,
        temperature: 0.7,
        return_full_text: false
      },
      options: { wait_for_model: true }
    }, {
      headers: {
        'Authorization': `Bearer ${HF_API_KEY}`,
        'Content-Type': 'application/json'
      },
      timeout: 120000 // 2 minutes for DeepSeek
    });

    console.log('Got response from HF');
    const text = response.data[0]?.generated_text || 'No response';

    res.json({
      id: 'chatcmpl-' + Date.now(),
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model: 'deepseek-r1',
      choices: [{
        index: 0,
        message: { role: 'assistant', content: text },
        finish_reason: 'stop'
      }]
    });
    
  } catch (error) {
    console.error('ERROR:', error.message);
    console.error('Full error:', error.response?.data);
    res.status(500).json({
      error: { message: error.response?.data?.error || error.message }
    });
  }
}

// Catch all
app.all('*', (req, res) => {
  console.log('Unknown path:', req.method, req.path);
  res.status(404).json({ error: { message: `Path ${req.path} not found` } });
});

app.listen(PORT, () => {
  console.log(`DeepSeek R1 Proxy running on port ${PORT}`);
});
