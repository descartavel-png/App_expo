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

// 🔥 REASONING DISPLAY TOGGLE
const SHOW_REASONING = false; // Set to false to hide <think> tags

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    service: 'Hugging Face DeepSeek R1 Proxy',
    model: HF_MODEL,
    reasoning_display: SHOW_REASONING
  });
});

// List models endpoint (OpenAI compatible)
app.get('/v1/models', (req, res) => {
  res.json({
    object: 'list',
    data: [
      {
        id: 'deepseek-r1',
        object: 'model',
        created: Date.now(),
        owned_by: 'huggingface'
      },
      {
        id: 'gpt-4',
        object: 'model',
        created: Date.now(),
        owned_by: 'huggingface'
      }
    ]
  });
});

// Helper function to convert messages to prompt
function messagesToPrompt(messages) {
  let prompt = '';
  for (const msg of messages) {
    if (msg.role === 'system') {
      prompt += `System: ${msg.content}\n\n`;
    } else if (msg.role === 'user') {
      prompt += `User: ${msg.content}\n\n`;
    } else if (msg.role === 'assistant') {
      prompt += `Assistant: ${msg.content}\n\n`;
    }
  }
  prompt += 'Assistant:';
  return prompt;
}

// Helper function to parse thinking tags
function parseResponse(text) {
  if (!SHOW_REASONING) {
    // Remove thinking tags and content
    text = text.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
  }
  return text;
}

// Chat completions endpoint (main proxy)
app.post('/v1/chat/completions', async (req, res) => {
  try {
    const { messages, temperature, max_tokens, stream } = req.body;
    
    if (!HF_API_KEY) {
      return res.status(500).json({
        error: {
          message: 'HF_API_KEY not configured',
          type: 'configuration_error',
          code: 500
        }
      });
    }

    // Convert messages to prompt format
    const prompt = messagesToPrompt(messages);
    
    // Prepare request to Hugging Face
    const hfRequest = {
      inputs: prompt,
      parameters: {
        max_new_tokens: max_tokens || 2048,
        temperature: temperature || 0.7,
        top_p: 0.95,
        do_sample: true,
        return_full_text: false
      },
      options: {
        use_cache: false,
        wait_for_model: true
      }
    };

    if (stream) {
      // Streaming response
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');

      try {
        const response = await axios.post(HF_API_URL, hfRequest, {
          headers: {
            'Authorization': `Bearer ${HF_API_KEY}`,
            'Content-Type': 'application/json'
          }
        });

        const generatedText = response.data[0]?.generated_text || '';
        const parsedText = parseResponse(generatedText);
        
        // Split into chunks for streaming
        const words = parsedText.split(' ');
        for (let i = 0; i < words.length; i++) {
          const chunk = {
            id: `chatcmpl-${Date.now()}`,
            object: 'chat.completion.chunk',
            created: Math.floor(Date.now() / 1000),
            model: 'deepseek-r1',
            choices: [{
              index: 0,
              delta: {
                content: words[i] + (i < words.length - 1 ? ' ' : '')
              },
              finish_reason: i === words.length - 1 ? 'stop' : null
            }]
          };
          
          res.write(`data: ${JSON.stringify(chunk)}\n\n`);
          
          // Small delay for streaming effect
          await new Promise(resolve => setTimeout(resolve, 30));
        }
        
        res.write('data: [DONE]\n\n');
        res.end();

      } catch (error) {
        console.error('Streaming error:', error.message);
        res.write(`data: {"error": "${error.message}"}\n\n`);
        res.end();
      }

    } else {
      // Non-streaming response
      const response = await axios.post(HF_API_URL, hfRequest, {
        headers: {
          'Authorization': `Bearer ${HF_API_KEY}`,
          'Content-Type': 'application/json'
        }
      });

      const generatedText = response.data[0]?.generated_text || '';
      const parsedText = parseResponse(generatedText);

      const openaiResponse = {
        id: `chatcmpl-${Date.now()}`,
        object: 'chat.completion',
        created: Math.floor(Date.now() / 1000),
        model: 'deepseek-r1',
        choices: [{
          index: 0,
          message: {
            role: 'assistant',
            content: parsedText
          },
          finish_reason: 'stop'
        }],
        usage: {
          prompt_tokens: prompt.split(' ').length,
          completion_tokens: parsedText.split(' ').length,
          total_tokens: prompt.split(' ').length + parsedText.split(' ').length
        }
      };

      res.json(openaiResponse);
    }
    
  } catch (error) {
    console.error('Proxy error:', error.response?.data || error.message);
    
    let errorMessage = 'Internal server error';
    let statusCode = 500;
    
    if (error.response?.status === 503) {
      errorMessage = 'Model is loading, please try again in a moment';
      statusCode = 503;
    } else if (error.response?.status === 429) {
      errorMessage = 'Rate limit exceeded, please try again later';
      statusCode = 429;
    } else if (error.response?.data) {
      errorMessage = error.response.data.error || errorMessage;
    }
    
    res.status(statusCode).json({
      error: {
        message: errorMessage,
        type: 'api_error',
        code: statusCode
      }
    });
  }
});

// Catch-all for unsupported endpoints
app.all('*', (req, res) => {
  res.status(404).json({
    error: {
      message: `Endpoint ${req.path} not found`,
      type: 'invalid_request_error',
      code: 404
    }
  });
});

app.listen(PORT, () => {
  console.log(`Hugging Face DeepSeek R1 Proxy running on port ${PORT}`);
  console.log(`Model: ${HF_MODEL}`);
  console.log(`Health check: http://localhost:${PORT}/health`);
  console.log(`Reasoning display: ${SHOW_REASONING ? 'ENABLED' : 'DISABLED'}`);
});
