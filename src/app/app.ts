import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  OnDestroy,
  ViewChild,
  signal,
  computed,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatCardModule } from '@angular/material/card';
import { MatToolbarModule } from '@angular/material/toolbar';
import { MatListModule } from '@angular/material/list';
import { MatChipsModule } from '@angular/material/chips';
import { GoogleGenAI, Type } from '@google/genai';

interface SecurityEvent {
  id: string;
  timestamp: Date;
  type: 'shoplifting' | 'fall' | 'suspicious' | 'normal';
  description: string;
  confidence: number;
  imageUrl: string;
  boundingBox?: [number, number, number, number];
}

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-root',
  imports: [
    CommonModule,
    MatButtonModule,
    MatIconModule,
    MatCardModule,
    MatToolbarModule,
    MatListModule,
    MatChipsModule,
  ],
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class App implements OnDestroy {
  @ViewChild('videoElement') videoElement!: ElementRef<HTMLVideoElement>;
  @ViewChild('canvasElement') canvasElement!: ElementRef<HTMLCanvasElement>;
  @ViewChild('fileInput') fileInput!: ElementRef<HTMLInputElement>;

  isMonitoring = signal(false);
  events = signal<SecurityEvent[]>([]);
  archivedEvents = signal<SecurityEvent[]>([]);
  showArchived = signal(false);
  latestEvent = computed(() => this.events()[0]);
  currentDetection = signal<SecurityEvent | null>(null);
  
  displayEvents = computed(() => this.showArchived() ? this.archivedEvents() : this.events());
  
  private stream: MediaStream | null = null;
  private monitorInterval: ReturnType<typeof setInterval> | null = null;
  private ai: GoogleGenAI;

  constructor() {
    this.ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
  }

  ngOnDestroy() {
    this.stopMonitoring();
  }

  triggerFileInput() {
    this.fileInput.nativeElement.click();
  }

  async handleFileUpload(event: Event) {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (!file) return;

    this.stopMonitoring();

    const url = URL.createObjectURL(file);
    if (this.videoElement?.nativeElement) {
      this.videoElement.nativeElement.srcObject = null;
      this.videoElement.nativeElement.src = url;
      this.videoElement.nativeElement.loop = true;
      await this.videoElement.nativeElement.play();
    }

    this.isMonitoring.set(true);
    this.monitorInterval = setInterval(() => this.analyzeFrame(), 5000);
  }

  async toggleMonitoring() {
    if (this.isMonitoring()) {
      this.stopMonitoring();
    } else {
      await this.startMonitoring();
    }
  }

  private async startMonitoring() {
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' },
        audio: false,
      });
      
      if (this.videoElement?.nativeElement) {
        this.videoElement.nativeElement.srcObject = this.stream;
        this.videoElement.nativeElement.play();
      }

      this.isMonitoring.set(true);
      
      // Analyze a frame every 5 seconds
      this.monitorInterval = setInterval(() => this.analyzeFrame(), 5000);
    } catch (err) {
      console.error('Error accessing camera:', err);
      alert('Could not access camera. Please ensure permissions are granted.');
    }
  }

  private stopMonitoring() {
    this.isMonitoring.set(false);
    if (this.monitorInterval) {
      clearInterval(this.monitorInterval);
      this.monitorInterval = null;
    }
    if (this.stream) {
      this.stream.getTracks().forEach(track => track.stop());
      this.stream = null;
    }
    if (this.videoElement?.nativeElement) {
      this.videoElement.nativeElement.srcObject = null;
    }
  }

  private async analyzeFrame() {
    if (!this.videoElement?.nativeElement || !this.canvasElement?.nativeElement) return;

    const video = this.videoElement.nativeElement;
    const canvas = this.canvasElement.nativeElement;
    
    if (video.videoWidth === 0 || video.videoHeight === 0) return;

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    
    // Get base64 image
    const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
    const base64Data = dataUrl.split(',')[1];

    try {
      const prompt = `You are an expert loss prevention AI analyzing a single frame from a retail security camera.
Analyze the frame and classify the primary activity into one of the following categories:

1. 'shoplifting': The act of concealing unpaid merchandise. Look for specific, subtle hand movements: slipping items into sleeves, dropping items into open personal bags (purses, backpacks, reusable shopping bags not provided by the store), tucking items into waistbands, or hiding items under other merchandise. Distinguish this from simply holding an item. The key is the *intent to conceal*.
2. 'suspicious': Actions that often precede theft, such as staging items in blind spots, looking around nervously at cameras/staff instead of products, unusual erratic movements, or holding items unusually close to the body while looking away.
3. 'fall': A person on the ground or in the process of collapsing.
4. 'normal': Customers browsing, carrying items openly in hands or store-provided shopping baskets/carts, inspecting items, interacting with staff, or walking normally.

CRITICAL: To reduce false positives, if a person is simply holding an item, inspecting it, looking at their phone, or putting an item in a store-provided basket/cart, classify it as 'normal'. Only flag 'shoplifting' if there is clear visual evidence of concealment (e.g., hand entering a pocket with an item, item disappearing into a personal bag).

Return a JSON object with 'type', 'description' (detailed explanation of hand movements, item interactions, and body language), and 'confidence' (number between 0 and 1).`;

      const response = await this.ai.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: [
          {
            inlineData: {
              data: base64Data,
              mimeType: 'image/jpeg',
            }
          },
          prompt
        ],
        config: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              type: {
                type: Type.STRING,
                description: "The type of event detected."
              },
              description: {
                type: Type.STRING,
                description: "A brief description of the detected event."
              },
              confidence: {
                type: Type.NUMBER,
                description: "Confidence level of the detection, between 0 and 1."
              },
              boundingBox: {
                type: Type.ARRAY,
                items: { type: Type.NUMBER },
                description: "Bounding box of the detected activity in [ymin, xmin, ymax, xmax] format, normalized to 0-1000. Required if type is not 'normal'."
              }
            },
            required: ['type', 'description', 'confidence']
          }
        }
      });

      const resultText = response.text;
      if (resultText) {
        const result = JSON.parse(resultText);
        
        if (result.type !== 'normal' && result.confidence > 0.6) {
          const newEvent: SecurityEvent = {
            id: Math.random().toString(36).substring(2, 9),
            timestamp: new Date(),
            type: result.type,
            description: result.description,
            confidence: result.confidence,
            imageUrl: dataUrl,
            boundingBox: result.boundingBox
          };
          
          this.currentDetection.set(newEvent);
          
          this.events.update(events => {
            const updatedEvents = [newEvent, ...events];
            if (updatedEvents.length > 20) {
              const toArchive = updatedEvents.pop();
              if (toArchive) {
                this.archivedEvents.update(archived => [toArchive, ...archived].slice(0, 500));
              }
            }
            return updatedEvents;
          });
        } else {
          this.currentDetection.set(null);
        }
      }
    } catch (error) {
      console.error('Error analyzing frame:', error);
      this.currentDetection.set(null);
    }
  }
  
  getEventIcon(type: string): string {
    switch(type) {
      case 'shoplifting': return 'warning';
      case 'fall': return 'personal_injury';
      case 'suspicious': return 'visibility';
      default: return 'info';
    }
  }
  
  getEventColor(type: string): string {
    switch(type) {
      case 'shoplifting': return 'bg-red-100 text-red-800 border-red-200';
      case 'fall': return 'bg-orange-100 text-orange-800 border-orange-200';
      case 'suspicious': return 'bg-yellow-100 text-yellow-800 border-yellow-200';
      default: return 'bg-gray-100 text-gray-800 border-gray-200';
    }
  }

  toggleArchived() {
    this.showArchived.update(show => !show);
  }

  clearArchive() {
    this.archivedEvents.set([]);
  }

  getBoundingBoxStyle(box: [number, number, number, number] | undefined, type: string) {
    if (!box || box.length !== 4) return { display: 'none' };
    const [ymin, xmin, ymax, xmax] = box;
    
    let borderColor = 'rgba(239, 68, 68, 0.8)'; // red-500
    let bgColor = 'rgba(239, 68, 68, 0.2)';
    
    if (type === 'suspicious') {
      borderColor = 'rgba(234, 179, 8, 0.8)'; // yellow-500
      bgColor = 'rgba(234, 179, 8, 0.2)';
    } else if (type === 'fall') {
      borderColor = 'rgba(249, 115, 22, 0.8)'; // orange-500
      bgColor = 'rgba(249, 115, 22, 0.2)';
    }

    return {
      top: `${ymin / 10}%`,
      left: `${xmin / 10}%`,
      height: `${(ymax - ymin) / 10}%`,
      width: `${(xmax - xmin) / 10}%`,
      position: 'absolute',
      border: `3px solid ${borderColor}`,
      backgroundColor: bgColor,
      zIndex: 20,
      borderRadius: '8px',
      transition: 'all 0.3s ease-in-out'
    };
  }
}
