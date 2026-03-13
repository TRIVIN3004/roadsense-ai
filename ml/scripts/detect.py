import cv2
from ultralytics import YOLO

def run_inference(image_path):
    # Load the custom RoadSense YOLOv8 model
    model = YOLO('../models/pothole_v1.pt')
    
    # Run detection
    results = model(image_path)
    
    # Process results
    for r in results:
        print(f"Detected {len(r.boxes)} road anomalies.")
        # Logic to extract coordinates and severity
