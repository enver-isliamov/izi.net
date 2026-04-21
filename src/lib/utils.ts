import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    } else {
      // Fallback for older browsers or insecure contexts (like HTTP or some iframes)
      const textArea = document.createElement("textarea");
      textArea.value = text;
      // Move it off-screen
      textArea.style.position = "absolute";
      textArea.style.left = "-999999px";
      document.body.prepend(textArea);
      textArea.focus();
      textArea.select();
      try {
        const successful = document.execCommand('copy');
        textArea.remove();
        return successful;
      } catch (error) {
        console.error('Fallback copy failed', error);
        textArea.remove();
        return false;
      }
    }
  } catch (error) {
    console.error('Copy failed', error);
    return false;
  }
}

