import * as THREE from 'three';

/** Ahşap sandalye; koltuk çerçevesinde (+Z masaya bakar) durur */
export function Chair({ position, quaternion, color = '#4a2c1a' }: { position: THREE.Vector3; quaternion: THREE.Quaternion; color?: string }) {
  const legs: [number, number][] = [
    [-0.2, 0.06],
    [0.2, 0.06],
    [-0.2, -0.32],
    [0.2, -0.32],
  ];
  return (
    <group position={position} quaternion={quaternion}>
      <mesh position={[0, 0.45, -0.13]} castShadow receiveShadow>
        <boxGeometry args={[0.46, 0.05, 0.44]} />
        <meshStandardMaterial color={color} roughness={0.7} />
      </mesh>
      {legs.map(([x, z], i) => (
        <mesh key={i} position={[x, 0.215, z]} castShadow>
          <boxGeometry args={[0.04, 0.43, 0.04]} />
          <meshStandardMaterial color={color} roughness={0.7} />
        </mesh>
      ))}
      <mesh position={[0, 0.78, -0.34]} rotation={[-0.08, 0, 0]} castShadow>
        <boxGeometry args={[0.46, 0.6, 0.04]} />
        <meshStandardMaterial color={color} roughness={0.7} />
      </mesh>
    </group>
  );
}
