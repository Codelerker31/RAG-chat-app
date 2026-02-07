import React, { useEffect, useRef } from 'react';
import { useLiveSession } from '../hooks/useLiveSession';
import { Message } from '../types';

interface LiveModeProps {
    isOpen: boolean;
    onClose: () => void;
    onNewMessage: (msg: Message) => void;
    chatHistory: Message[];
}

export const LiveMode: React.FC<LiveModeProps> = ({ isOpen, onClose, onNewMessage, chatHistory }) => {
    const {
        status,
        transcript,
        startSession,
        stopSession,
        videoStream,
        error
    } = useLiveSession({ onNewMessage, chatHistory });

    const videoRef = useRef<HTMLVideoElement>(null);

    // Auto-start session when opened
    useEffect(() => {
        if (isOpen) {
            startSession();
        } else {
            stopSession();
        }
    }, [isOpen]);

    // Attach stream to video element
    useEffect(() => {
        if (videoRef.current && videoStream) {
            videoRef.current.srcObject = videoStream;
        }
    }, [videoStream]);

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-50 bg-black/95 flex flex-col items-center justify-center p-4">
            {/* Header / Controls */}
            <div className="absolute top-4 right-4 z-10 flex gap-4">
                <button
                    onClick={onClose}
                    className="bg-red-500/20 hover:bg-red-500/40 text-red-500 px-4 py-2 rounded-full border border-red-500/50 transition-colors"
                >
                    End Live Session
                </button>
            </div>

            {/* Main Video Stage */}
            <div className="relative w-full max-w-5xl aspect-video bg-gray-900 rounded-2xl overflow-hidden border border-gray-800 shadow-2xl">
                {videoStream ? (
                    <video
                        ref={videoRef}
                        autoPlay
                        muted
                        playsInline
                        className="w-full h-full object-cover"
                    />
                ) : (
                    <div className="w-full h-full flex items-center justify-center text-gray-500">
                        <div className="flex flex-col items-center gap-2">
                            <div className="animate-spin h-8 w-8 border-2 border-indigo-500 border-t-transparent rounded-full"></div>
                            <p>Initializing Media...</p>
                        </div>
                    </div>
                )}

                {/* Status Overlay */}
                <div className="absolute bottom-6 left-6 right-6 flex items-end justify-between">
                    <div className="flex flex-col gap-2 max-w-2xl">
                        {/* Status Indicator */}
                        <div className="flex items-center gap-3 bg-black/60 backdrop-blur-md px-4 py-2 rounded-full w-fit border border-white/10">
                            <div className={`w-3 h-3 rounded-full ${status === 'listening' ? 'bg-green-500 animate-pulse' :
                                    status === 'recording' ? 'bg-red-500 animate-pulse' :
                                        status === 'processing' ? 'bg-blue-500 animate-bounce' :
                                            status === 'speaking' ? 'bg-indigo-500' :
                                                'bg-gray-500'
                                }`} />
                            <span className="text-sm font-medium text-gray-200 capitalize">
                                {status === 'listening' ? 'Listening... (Speak now)' :
                                    status === 'recording' ? 'Recording Context...' :
                                        status === 'processing' ? 'Thinking...' :
                                            status === 'speaking' ? 'Speaking...' : status}
                            </span>
                        </div>

                        {/* Live Transcript */}
                        {transcript && (
                            <div className="bg-black/60 backdrop-blur-md px-6 py-4 rounded-xl border border-white/10 animate-fade-in-up">
                                <p className="text-xl font-light text-white leading-relaxed">
                                    "{transcript}"
                                </p>
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {/* Error Message */}
            {error && (
                <div className="absolute top-20 left-1/2 -translate-x-1/2 bg-red-500/10 border border-red-500 text-red-100 px-6 py-3 rounded-lg backdrop-blur-md">
                    {error}
                </div>
            )}
        </div>
    );
};
