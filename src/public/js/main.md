```js
const defaultProfiles = {
  gamecube: {
    name: 'GameCube Adapter',
    regex: 'gamecube|mayflash',
    // [A, B, X, Y, LB, RB, LT, RT, Select, Start, L3, R3, Up, Down, Left, Right, Home]
    // Replace these indices with the correct ones fired by your GameCube adapter
    buttons: [1, 2, 0, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16],
    axes: [0, 1, 2, 3],
    readonly: true,
  },
};
```
