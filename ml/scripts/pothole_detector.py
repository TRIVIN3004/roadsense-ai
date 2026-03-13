import cv2
from ultralytics import YOLO

def detect_potholes(source_path, model_path='yolov8n.pt', save_output=True):
    """
    Detects potholes in an image or video using YOLOv8.
    
    Args:
        source_path: Path to image or video file, or 0 for webcam.
        model_path: Path to the trained .pt model weights.
        save_output: Whether to save the processed result to disk.
    """
    
    # 1. Load the YOLOv8 Model
    # 'yolov8n.pt' is the nano version (fastest). 
    # In production, replace this with your custom trained 'best.pt'.
    model = YOLO(model_path)
    
    # 2. Initialize Video Capture (works for images, videos, or webcam)
    cap = cv2.VideoCapture(source_path)
    
    while cap.isOpened():
        success, frame = cap.read()
        if not success:
            break

        # 3. Run AI Inference
        # We set a confidence threshold (conf) to filter out weak detections.
        results = model.predict(frame, conf=0.5, iou=0.45)

        # 4. Process and Visualize Results
        # 'results[0].plot()' automatically draws bounding boxes and labels.
        annotated_frame = results[0].plot()

        # 5. Display the Result
        # Note: This requires a local GUI environment. 
        # For server-side, you would save the frame or stream it.
        cv2.imshow("RoadSense AI - Pothole Detection", annotated_frame)

        # 6. Metadata Extraction (Optional)
        for box in results[0].boxes:
            # Get coordinates, class ID, and confidence
            x1, y1, x2, y2 = box.xyxy[0]
            conf = box.conf[0]
            cls = box.cls[0]
            print(f"Detected {model.names[int(cls)]} with {conf:.2f} confidence at [{x1}, {y1}]")

        # Break loop on 'q' key press
        if cv2.waitKey(1) & 0xFF == ord("q"):
            break

    # Cleanup
    cap.release()
    cv2.destroyAllWindows()

if __name__ == "__main__":
    # Example usage:
    # detect_potholes("road_video.mp4") # For video
    # detect_potholes(0)                # For live webcam
    print("RoadSense AI Detector Initialized.")
