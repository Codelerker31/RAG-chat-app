import React from 'react';
import { Message, Role } from '../types';
import { DocumentIcon } from './Icon';

interface MessageBubbleProps {
    message: Message;
}

export const MessageBubble: React.FC<MessageBubbleProps> = ({ message }) => {
    const isUser = message.role === Role.USER;

    // Function to render text with markdown images
    const renderContent = (text: string) => {
        // Regex to match markdown images: ![alt](url)
        const imageRegex = /!\[([^\]]*)\]\(([^)]+)\)/g;
        const parts = [];
        let lastIndex = 0;
        let match;

        while ((match = imageRegex.exec(text)) !== null) {
            // Push preceding text
            if (match.index > lastIndex) {
                parts.push(<span key={lastIndex}>{text.substring(lastIndex, match.index)}</span>);
            }

            // Push image
            const altText = match[1];
            const imageUrl = match[2];
            parts.push(
                <div key={match.index} className="my-2">
                    <img
                        src={imageUrl}
                        alt={altText}
                        className="rounded-lg max-h-60 object-cover border border-slate-200 dark:border-slate-700"
                        loading="lazy"
                    />
                </div>
            );

            lastIndex = match.index + match[0].length;
        }

        // Push remaining text
        if (lastIndex < text.length) {
            parts.push(<span key={lastIndex}>{text.substring(lastIndex)}</span>);
        }

        return parts.length > 0 ? parts : text;
    };

    return (
        <div className={`flex w-full ${isUser ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[85%] md:max-w-[75%] rounded-2xl px-5 py-4 shadow-sm ${isUser
                ? 'bg-gradient-to-br from-violet-600 to-fuchsia-600 text-white rounded-br-sm'
                : 'bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700 rounded-bl-sm'
                }`}>
                <div className="whitespace-pre-wrap leading-relaxed text-sm md:text-base">
                    {renderContent(message.text)}
                    {message.isStreaming && (
                        <span className="inline-block w-2 h-4 ml-1 align-bottom bg-violet-500 animate-[pulse_0.7s_infinite]"></span>
                    )}
                </div>

                {message.role === Role.MODEL && message.sources && message.sources.length > 0 && (
                    <div className="mt-3 pt-3 border-t border-slate-100/50 dark:border-slate-700/50">
                        <p className="text-[10px] uppercase font-bold text-slate-400 mb-1">Sources Used</p>
                        <div className="flex flex-wrap gap-1">
                            {message.sources.map((s, idx) => (
                                <span key={idx} className="inline-flex items-center text-[10px] bg-slate-100 dark:bg-slate-900 text-slate-600 dark:text-slate-400 px-2 py-1 rounded-md border border-slate-200 dark:border-slate-700">
                                    <DocumentIcon />
                                    <span className="ml-1 font-medium max-w-[100px] truncate">{s.title}</span>
                                    <span className="ml-1 opacity-70">pg.{s.page || '?'}</span>
                                </span>
                            ))}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};
