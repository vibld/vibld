export type Ingredient = {
  id: string;
  name: string;
  quantity: number;
  unit: string;
};

export type Recipe = {
  id: string;
  name: string;
  ingredients: Ingredient[];
  steps: string[];
  baseServings: number;
  currentServings: number;
  favourite: boolean;
  blockColor: string;
};
