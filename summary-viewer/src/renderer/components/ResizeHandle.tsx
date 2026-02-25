interface ResizeHandleProps {
  index: number;
  onMouseDown: (index: number) => void;
  isActive: boolean;
}

export default function ResizeHandle({ index, onMouseDown, isActive }: ResizeHandleProps) {
  return (
    <div
      className={`resize-handle${isActive ? ' active' : ''}`}
      onMouseDown={() => onMouseDown(index)}
    />
  );
}
