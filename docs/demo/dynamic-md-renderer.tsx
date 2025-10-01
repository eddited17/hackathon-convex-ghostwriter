import React, { useState, useEffect, useRef } from 'react';
import { Sparkles, Wand2, Trash2 } from 'lucide-react';

const DynamicMarkdownRenderer = () => {
  const [markdown, setMarkdown] = useState('');
  const [displayedBlocks, setDisplayedBlocks] = useState([]);
  const [isSimulating, setIsSimulating] = useState(false);
  const [phase, setPhase] = useState(0);
  const [autoScroll, setAutoScroll] = useState(true);
  const newBlockRefs = useRef({});
  const processingRef = useRef(false);
  const targetMarkdownRef = useRef('');

  // Create content-based hash for better block matching
  const getBlockHash = (block) => {
    return JSON.stringify({ type: block.type, content: block.content, items: block.items });
  };

  // Parse markdown into structured blocks
  const parseMarkdown = (md) => {
    const lines = md.split('\n');
    const blocks = [];
    let codeBlockContent = [];
    let inCodeBlock = false;
    let listItems = [];

    lines.forEach((line) => {
      if (line.trim().startsWith('```')) {
        if (inCodeBlock) {
          blocks.push({
            type: 'code',
            content: codeBlockContent.join('\n'),
            hash: null
          });
          blocks[blocks.length - 1].hash = getBlockHash(blocks[blocks.length - 1]);
          codeBlockContent = [];
          inCodeBlock = false;
        } else {
          if (listItems.length > 0) {
            blocks.push({
              type: 'list',
              items: listItems,
              hash: null
            });
            blocks[blocks.length - 1].hash = getBlockHash(blocks[blocks.length - 1]);
            listItems = [];
          }
          inCodeBlock = true;
        }
        return;
      }

      if (inCodeBlock) {
        codeBlockContent.push(line);
        return;
      }

      const h1Match = line.match(/^# (.+)$/);
      const h2Match = line.match(/^## (.+)$/);
      const h3Match = line.match(/^### (.+)$/);
      
      if (h1Match) {
        if (listItems.length > 0) {
          blocks.push({
            type: 'list',
            items: listItems,
            hash: null
          });
          blocks[blocks.length - 1].hash = getBlockHash(blocks[blocks.length - 1]);
          listItems = [];
        }
        blocks.push({
          type: 'h1',
          content: h1Match[1],
          hash: null
        });
        blocks[blocks.length - 1].hash = getBlockHash(blocks[blocks.length - 1]);
      } else if (h2Match) {
        if (listItems.length > 0) {
          blocks.push({
            type: 'list',
            items: listItems,
            hash: null
          });
          blocks[blocks.length - 1].hash = getBlockHash(blocks[blocks.length - 1]);
          listItems = [];
        }
        blocks.push({
          type: 'h2',
          content: h2Match[1],
          hash: null
        });
        blocks[blocks.length - 1].hash = getBlockHash(blocks[blocks.length - 1]);
      } else if (h3Match) {
        if (listItems.length > 0) {
          blocks.push({
            type: 'list',
            items: listItems,
            hash: null
          });
          blocks[blocks.length - 1].hash = getBlockHash(blocks[blocks.length - 1]);
          listItems = [];
        }
        blocks.push({
          type: 'h3',
          content: h3Match[1],
          hash: null
        });
        blocks[blocks.length - 1].hash = getBlockHash(blocks[blocks.length - 1]);
      } else if (line.trim().match(/^[-*] (.+)$/)) {
        const match = line.trim().match(/^[-*] (.+)$/);
        listItems.push(match[1]);
      } else if (line.trim()) {
        if (listItems.length > 0) {
          blocks.push({
            type: 'list',
            items: listItems,
            hash: null
          });
          blocks[blocks.length - 1].hash = getBlockHash(blocks[blocks.length - 1]);
          listItems = [];
        }
        blocks.push({
          type: 'paragraph',
          content: line.trim(),
          hash: null
        });
        blocks[blocks.length - 1].hash = getBlockHash(blocks[blocks.length - 1]);
      } else if (line === '') {
        if (listItems.length > 0) {
          blocks.push({
            type: 'list',
            items: listItems,
            hash: null
          });
          blocks[blocks.length - 1].hash = getBlockHash(blocks[blocks.length - 1]);
          listItems = [];
        }
      }
    });

    if (listItems.length > 0) {
      blocks.push({
        type: 'list',
        items: listItems,
        hash: null
      });
      blocks[blocks.length - 1].hash = getBlockHash(blocks[blocks.length - 1]);
    }

    return blocks.map(block => ({ ...block, id: `block-${block.hash}`, state: 'visible' }));
  };

  // Transform document sequentially
  const transformDocument = async (targetBlocks) => {
    if (processingRef.current) return;
    processingRef.current = true;

    let currentBlocks = [...displayedBlocks];
    const currentHashSet = new Set(currentBlocks.map(b => b.hash));
    const targetHashSet = new Set(targetBlocks.map(b => b.hash));

    // Step 1: Remove blocks that are no longer in target
    for (let i = currentBlocks.length - 1; i >= 0; i--) {
      const block = currentBlocks[i];
      if (!targetHashSet.has(block.hash)) {
        // Mark for removal
        currentBlocks = currentBlocks.map((b, idx) =>
          idx === i ? { ...b, state: 'removing' } : b
        );
        setDisplayedBlocks([...currentBlocks]);
        
        await new Promise(resolve => setTimeout(resolve, 400));
        
        // Remove from array
        currentBlocks = currentBlocks.filter((_, idx) => idx !== i);
        setDisplayedBlocks([...currentBlocks]);
        
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }

    // Step 2: Insert new blocks at correct positions
    for (let targetIdx = 0; targetIdx < targetBlocks.length; targetIdx++) {
      const targetBlock = targetBlocks[targetIdx];
      
      if (!currentHashSet.has(targetBlock.hash)) {
        // This is a new block, insert it at the correct position
        const newBlock = { ...targetBlock, state: 'positioning' };
        
        // Find correct insertion position
        currentBlocks.splice(targetIdx, 0, newBlock);
        setDisplayedBlocks([...currentBlocks]);
        
        await new Promise(resolve => setTimeout(resolve, 25));
        
        // Check if scroll is needed
        if (autoScroll && newBlockRefs.current[newBlock.id]) {
          const element = newBlockRefs.current[newBlock.id];
          const rect = element.getBoundingClientRect();
          const isInView = rect.top >= 0 && rect.bottom <= window.innerHeight;
          
          if (!isInView) {
            element.scrollIntoView({
              behavior: 'smooth',
              block: 'center'
            });
            await new Promise(resolve => setTimeout(resolve, 300));
          }
        }
        
        // Materialize the block
        currentBlocks = currentBlocks.map((b) =>
          b.id === newBlock.id ? { ...b, state: 'materializing' } : b
        );
        setDisplayedBlocks([...currentBlocks]);
        
        await new Promise(resolve => setTimeout(resolve, 600));
        
        // Mark as visible
        currentBlocks = currentBlocks.map((b) =>
          b.id === newBlock.id ? { ...b, state: 'visible' } : b
        );
        setDisplayedBlocks([...currentBlocks]);
        
        // Update hash set
        currentHashSet.add(targetBlock.hash);
        
        await new Promise(resolve => setTimeout(resolve, 50));
      }
    }

    processingRef.current = false;
  };

  useEffect(() => {
    if (markdown !== targetMarkdownRef.current) {
      targetMarkdownRef.current = markdown;
      const targetBlocks = parseMarkdown(markdown);
      
      if (displayedBlocks.length === 0) {
        // First render, just show everything
        setDisplayedBlocks(targetBlocks);
      } else {
        // Transform from current to target
        transformDocument(targetBlocks);
      }
    }
  }, [markdown, autoScroll]);

  const renderInlineMarkdown = (text) => {
    let result = text.replace(/\*\*(.+?)\*\*/g, '<strong class="font-bold text-purple-700">$1</strong>');
    result = result.replace(/\*(.+?)\*/g, '<em class="italic">$1</em>');
    result = result.replace(/`(.+?)`/g, '<code class="px-1.5 py-0.5 bg-purple-100 rounded text-sm font-mono text-purple-700">$1</code>');
    return <span dangerouslySetInnerHTML={{ __html: result }} />;
  };

  const simulateAIWriting = () => {
    setIsSimulating(true);
    setMarkdown('');
    setPhase(0);
    
    const initialContent = `# The Future of AI-Powered Writing

Artificial intelligence is revolutionizing how we create content. Modern AI systems can understand context, maintain consistency, and generate human-like text that flows naturally.

## Key Benefits of AI Writing Systems

- Enhanced productivity through intelligent suggestions and auto-completion
- Consistent tone and style across long-form content
- Real-time collaboration between human creativity and machine precision

## Challenges and Limitations

While AI writing is powerful, it's important to understand its current limitations. AI systems can sometimes produce generic content or miss nuanced context that human writers naturally grasp.

## Looking Ahead

As AI continues to evolve, we can expect even more sophisticated writing assistance that adapts to individual styles, understands complex instructions, and generates increasingly nuanced content.`;

    const initialSections = initialContent.split('\n\n');
    let currentText = '';
    let sectionIndex = 0;

    const interval = setInterval(() => {
      if (sectionIndex < initialSections.length) {
        currentText += (sectionIndex > 0 ? '\n\n' : '') + initialSections[sectionIndex];
        setMarkdown(currentText);
        sectionIndex++;
      } else {
        clearInterval(interval);
        setIsSimulating(false);
        setPhase(1);
      }
    }, 400);
  };

  const insertNewContent = () => {
    setIsSimulating(true);
    
    const expandedContent = `# The Future of AI-Powered Writing

Artificial intelligence is revolutionizing how we create content. Modern AI systems can understand context, maintain consistency, and generate human-like text that flows naturally.

## Introduction to Intelligent Content Creation

The landscape of content creation is undergoing a profound transformation. AI-powered writing assistants are not just tools; they're collaborative partners that enhance human creativity while maintaining authentic voice and style.

Traditional writing processes often involve multiple drafts, extensive revisions, and time-consuming edits. With AI assistance, writers can focus on the creative aspects while the technology handles structure, grammar, and consistency.

## Key Benefits of AI Writing Systems

- Enhanced productivity through intelligent suggestions and auto-completion
- Consistent tone and style across long-form content
- Real-time collaboration between human creativity and machine precision
- Context awareness that adapts to your unique writing patterns
- Multilingual support for global content creation

## Challenges and Limitations

While AI writing is powerful, it's important to understand its current limitations. AI systems can sometimes produce generic content or miss nuanced context that human writers naturally grasp.

## The Technology Behind the Magic

Modern AI writing systems leverage advanced neural networks trained on vast amounts of text data. These models understand nuance, context, and even creative expression.

The architecture typically involves transformer models that process text bidirectionally, allowing them to understand both what came before and what comes after each word. This creates remarkably coherent and contextually appropriate suggestions.

## Looking Ahead

As AI continues to evolve, we can expect even more sophisticated writing assistance that adapts to individual styles, understands complex instructions, and generates increasingly nuanced content. The future of writing is collaborative, combining human insight with machine intelligence.`;

    setMarkdown(expandedContent);
    
    setTimeout(() => {
      setIsSimulating(false);
      setPhase(2);
    }, 6000);
  };

  const removeAndModify = () => {
    setIsSimulating(true);
    
    const finalContent = `# The Future of AI-Powered Writing

Artificial intelligence is revolutionizing how we create content. Modern AI systems can understand context, maintain consistency, and generate human-like text that flows naturally.

## Introduction to Intelligent Content Creation

The landscape of content creation is undergoing a profound transformation. AI-powered writing assistants are not just tools; they're collaborative partners that enhance human creativity while maintaining authentic voice and style.

## Key Benefits of AI Writing Systems

- Enhanced productivity through intelligent suggestions and auto-completion
- Consistent tone and style across long-form content
- Real-time collaboration between human creativity and machine precision
- Context awareness that adapts to your unique writing patterns
- Multilingual support for global content creation
- Continuous learning from user feedback and preferences

## The Technology Behind the Magic

Modern AI writing systems leverage advanced neural networks trained on vast amounts of text data. These models understand nuance, context, and even creative expression.

## Practical Applications

From blog posts to technical documentation, from creative fiction to business reports, AI writing assistants are finding their place across diverse writing needs. The key is understanding how to collaborate effectively with these tools.

Writers who embrace AI assistance report significant time savings without sacrificing quality. The technology acts as a thought partner, helping to overcome writer's block and explore new narrative directions.

## Looking Ahead

As AI continues to evolve, we can expect even more sophisticated writing assistance that adapts to individual styles, understands complex instructions, and generates increasingly nuanced content. The future of writing is collaborative, combining human insight with machine intelligence.`;

    setMarkdown(finalContent);
    
    setTimeout(() => {
      setIsSimulating(false);
      setPhase(3);
    }, 4000);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-indigo-50 via-purple-50 to-pink-50">
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-40 -right-40 w-80 h-80 bg-purple-300 rounded-full mix-blend-multiply filter blur-xl opacity-20 animate-blob"></div>
        <div className="absolute -bottom-40 -left-40 w-80 h-80 bg-pink-300 rounded-full mix-blend-multiply filter blur-xl opacity-20 animate-blob animation-delay-2000"></div>
        <div className="absolute top-1/2 left-1/2 w-80 h-80 bg-indigo-300 rounded-full mix-blend-multiply filter blur-xl opacity-20 animate-blob animation-delay-4000"></div>
      </div>

      <div className="relative">
        <div className="sticky top-0 z-10 bg-white/80 backdrop-blur-lg border-b border-purple-100 shadow-sm">
          <div className="max-w-4xl mx-auto px-8 py-4">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-3">
                <div className="relative">
                  <Wand2 className="w-7 h-7 text-purple-600" />
                  <Sparkles className="w-4 h-4 text-pink-500 absolute -top-1 -right-1 animate-pulse" />
                </div>
                <h1 className="text-2xl font-bold bg-gradient-to-r from-purple-600 to-pink-600 bg-clip-text text-transparent">
                  AI Ghostwriter
                </h1>
              </div>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={autoScroll}
                  onChange={(e) => setAutoScroll(e.target.checked)}
                  className="w-4 h-4 text-purple-600 rounded focus:ring-purple-500"
                />
                <span className="text-sm text-gray-600">Auto-scroll to new content</span>
              </label>
            </div>
            <div className="flex items-center gap-3 justify-end">
              <button
                onClick={simulateAIWriting}
                disabled={isSimulating || phase > 0}
                className="px-5 py-2.5 bg-gradient-to-r from-purple-600 to-pink-600 text-white rounded-full font-semibold shadow-lg hover:shadow-xl transform hover:scale-105 transition-all disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none flex items-center gap-2"
              >
                {isSimulating && phase === 0 ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                    Writing...
                  </>
                ) : (
                  <>
                    <Sparkles className="w-4 h-4" />
                    Phase 1: Initial
                  </>
                )}
              </button>
              
              <button
                onClick={insertNewContent}
                disabled={phase !== 1 || isSimulating}
                className="px-5 py-2.5 bg-gradient-to-r from-indigo-600 to-purple-600 text-white rounded-full font-semibold shadow-lg hover:shadow-xl transform hover:scale-105 transition-all disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none flex items-center gap-2"
              >
                {isSimulating && phase === 1 ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                    Inserting...
                  </>
                ) : (
                  <>
                    <Wand2 className="w-4 h-4" />
                    Phase 2: Insert
                  </>
                )}
              </button>

              <button
                onClick={removeAndModify}
                disabled={phase !== 2 || isSimulating}
                className="px-5 py-2.5 bg-gradient-to-r from-rose-600 to-pink-600 text-white rounded-full font-semibold shadow-lg hover:shadow-xl transform hover:scale-105 transition-all disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none flex items-center gap-2"
              >
                {isSimulating && phase === 2 ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                    Updating...
                  </>
                ) : (
                  <>
                    <Trash2 className="w-4 h-4" />
                    Phase 3: Remove+Add
                  </>
                )}
              </button>
            </div>
          </div>
        </div>

        <div className="max-w-4xl mx-auto px-8 py-12">
          <div className="bg-white rounded-2xl shadow-2xl p-12 min-h-[600px] relative overflow-hidden">
            <div className="absolute inset-0 opacity-5 pointer-events-none" style={{
              backgroundImage: 'repeating-linear-gradient(0deg, transparent, transparent 2px, #000 2px, #000 3px)'
            }}></div>
            
            <div className="relative prose prose-lg max-w-none">
              {displayedBlocks.map((block) => (
                <div
                  key={block.id}
                  ref={(el) => {
                    if (el) newBlockRefs.current[block.id] = el;
                  }}
                  className={`
                    transition-all duration-500 ease-out
                    ${block.state === 'positioning' ? 'opacity-0' : ''}
                    ${block.state === 'materializing' ? 'animate-materialize' : ''}
                    ${block.state === 'visible' ? 'opacity-100' : ''}
                    ${block.state === 'removing' ? 'animate-fadeOut' : ''}
                  `}
                >
                  {block.type === 'h1' && (
                    <h1 className="text-5xl font-bold mb-8 mt-0 bg-gradient-to-r from-purple-600 via-pink-600 to-purple-600 bg-clip-text text-transparent leading-tight">
                      {block.content}
                    </h1>
                  )}
                  
                  {block.type === 'h2' && (
                    <h2 className="text-3xl font-bold mt-12 mb-6 text-gray-800 border-l-4 border-purple-500 pl-4">
                      {block.content}
                    </h2>
                  )}
                  
                  {block.type === 'h3' && (
                    <h3 className="text-2xl font-semibold mt-8 mb-4 text-gray-700">
                      {block.content}
                    </h3>
                  )}
                  
                  {block.type === 'paragraph' && (
                    <p className="text-gray-700 leading-relaxed mb-6 text-lg">
                      {renderInlineMarkdown(block.content)}
                    </p>
                  )}
                  
                  {block.type === 'list' && (
                    <ul className="space-y-3 mb-6 ml-6">
                      {block.items.map((item, i) => (
                        <li key={i} className="text-gray-700 text-lg leading-relaxed relative pl-2">
                          <span className="absolute -left-6 top-2 w-2 h-2 bg-gradient-to-r from-purple-500 to-pink-500 rounded-full"></span>
                          {renderInlineMarkdown(item)}
                        </li>
                      ))}
                    </ul>
                  )}
                  
                  {block.type === 'code' && (
                    <pre className="bg-gray-900 rounded-xl p-6 overflow-x-auto mb-6 shadow-lg">
                      <code className="text-green-400 font-mono text-sm">{block.content}</code>
                    </pre>
                  )}
                </div>
              ))}

              {displayedBlocks.length === 0 && (
                <div className="text-center py-24">
                  <div className="inline-block p-6 bg-gradient-to-br from-purple-100 to-pink-100 rounded-full mb-6">
                    <Wand2 className="w-16 h-16 text-purple-600" />
                  </div>
                  <p className="text-gray-400 text-xl">Click "Phase 1" to start</p>
                  <p className="text-gray-300 text-sm mt-2">Watch the document transform sequentially</p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      <style jsx>{`
        @keyframes materialize {
          0% {
            opacity: 0;
            transform: translateY(40px) scale(0.92);
            filter: blur(12px);
          }
          60% {
            opacity: 0.6;
          }
          100% {
            opacity: 1;
            transform: translateY(0) scale(1);
            filter: blur(0);
          }
        }

        @keyframes fadeOut {
          0% {
            opacity: 1;
            transform: translateX(0) scale(1);
            filter: blur(0);
          }
          100% {
            opacity: 0;
            transform: translateX(-30px) scale(0.95);
            filter: blur(8px);
          }
        }

        @keyframes blob {
          0%, 100% {
            transform: translate(0, 0) scale(1);
          }
          33% {
            transform: translate(30px, -50px) scale(1.1);
          }
          66% {
            transform: translate(-20px, 20px) scale(0.9);
          }
        }

        .animate-materialize {
          animation: materialize 0.6s cubic-bezier(0.34, 1.56, 0.64, 1) forwards;
        }

        .animate-fadeOut {
          animation: fadeOut 0.4s cubic-bezier(0.4, 0, 1, 1) forwards;
        }

        .animate-blob {
          animation: blob 7s infinite;
        }

        .animation-delay-2000 {
          animation-delay: 2s;
        }

        .animation-delay-4000 {
          animation-delay: 4s;
        }

        .prose {
          max-width: none;
        }

        .prose p {
          margin: 0;
        }

        .prose ul {
          list-style: none;
          padding: 0;
        }
      `}</style>
    </div>
  );
};

export default DynamicMarkdownRenderer;