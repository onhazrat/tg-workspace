import React from "react";
import { motion, AnimatePresence } from "motion/react";
import { X } from "lucide-react";

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}

export function Modal({ isOpen, onClose, title, children, footer }: ModalProps) {
  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="absolute inset-0 bg-app-bg/80 backdrop-blur-sm"
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            className="relative w-full max-w-md bg-app-card border border-app-ink border-opacity-10 shadow-2xl flex flex-col max-h-[90vh]"
          >
            <div className="flex justify-between items-center p-4 border-b border-app-ink/10 shrink-0">
              <h3 className="text-lg font-bold tracking-tight">{title}</h3>
              <button
                onClick={onClose}
                className="p-1 rounded-md hover:bg-app-muted transition-colors opacity-60 hover:opacity-100"
              >
                <X size={18} />
              </button>
            </div>
            
            <div className="p-6 overflow-y-auto flex-1">
              {children}
            </div>

            {footer && (
              <div className="p-4 border-t border-app-ink/10 bg-app-muted/30 shrink-0">
                {footer}
              </div>
            )}
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
