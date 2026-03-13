from ultralytics import YOLO

def train():
    model = YOLO('yolov8n.pt')  # Load a pretrained model
    
    # Train the model on our road damage dataset
    results = model.train(
        data='../dataset/data.yaml',
        epochs=100,
        imgsz=640,
        device=0
    )
