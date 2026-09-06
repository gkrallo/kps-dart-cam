import { useState, useEffect } from 'react';

// Global deklation för OpenCV
declare global {
  interface Window {
    cv: any;
  }
}

export const useOpenCV = () => {
  const [isLoaded, setIsLoaded] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    // Om cv redan finns, markera som laddad
    if (window.cv && window.cv.Mat) {
      setIsLoaded(true);
      setIsLoading(false);
      return;
    }

    const scriptId = 'opencv-script';
    
    // Undvik att ladda scriptet flera gånger
    if (document.getElementById(scriptId)) {
      return;
    }

    const script = document.createElement('script');
    script.id = scriptId;
    script.src = 'https://docs.opencv.org/4.8.0/opencv.js';
    script.async = true;

    script.onload = () => {
      // OpenCV definierar ibland cv i fönstret innan det är fullt initialiserat
      // window.cv.onRuntimeInitialized kan användas, men i nyare versioner av opencv.js 
      // kan cv redan vara redo i onload om det är en asynkron modul, eller så
      // anropas cv() som en promise.
      
      const checkCvReady = () => {
        if (window.cv && window.cv.Mat) {
          setIsLoaded(true);
          setIsLoading(false);
        } else {
          // Om Mat inte finns än (wasm inte helt laddad), vänta och försök igen
          if (window.cv instanceof Promise) {
            window.cv.then((cv: any) => {
               window.cv = cv;
               setIsLoaded(true);
               setIsLoading(false);
            }).catch((err: any) => {
               setError(new Error('Kunde inte ladda OpenCV.js modulen'));
               setIsLoading(false);
            });
          } else {
            // Traditionell callback om defined
            if(window.cv && typeof window.cv.onRuntimeInitialized !== "undefined"){
                window.cv.onRuntimeInitialized = () => {
                    setIsLoaded(true);
                    setIsLoading(false);
                };
            } else {
                // Fallback polling
                setTimeout(checkCvReady, 100);
            }
          }
        }
      };
      
      checkCvReady();
    };

    script.onerror = () => {
      setError(new Error('Det gick inte att ladda OpenCV.js från CDN'));
      setIsLoading(false);
    };

    document.body.appendChild(script);

    return () => {
      // Vi tar normalt inte bort scriptet för att undvika omladdningar
    };
  }, []);

  return { isLoaded, isLoading, error, cv: window.cv };
};
