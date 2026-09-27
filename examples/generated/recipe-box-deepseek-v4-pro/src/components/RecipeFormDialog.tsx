import { useEffect, useState } from 'react'
import { Plus, X } from 'lucide-react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import type { Ingredient, Recipe } from '@/types'

const generateId = () => crypto.randomUUID() || Math.random().toString(36).slice(2)

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialRecipe: Recipe | null;
  onSave: (recipe: Recipe) => void;
}

export default function RecipeFormDialog({ open, onOpenChange, initialRecipe, onSave }: Props) {
  const [name, setName] = useState('')
  const [baseServings, setBaseServings] = useState(4)
  const [ingredients, setIngredients] = useState<Ingredient[]>([])
  const [steps, setSteps] = useState<string[]>([])
  const [errors, setErrors] = useState<{ name?: string; ingredientNames?: string[]; stepTexts?: string[] }>({})

  useEffect(() => {
    if (open) {
      if (initialRecipe) {
        setName(initialRecipe.name)
        setBaseServings(initialRecipe.baseServings)
        setIngredients(initialRecipe.ingredients.map(ing => ({ ...ing })))
        setSteps(initialRecipe.steps.slice())
      } else {
        setName('')
        setBaseServings(4)
        setIngredients([{ id: generateId(), name: '', quantity: 1, unit: '' }])
        setSteps([''])
      }
      setErrors({})
    }
  }, [open, initialRecipe])

  const updateIngredient = (index: number, field: keyof Ingredient, value: string | number) => {
    setIngredients(prev => prev.map((ing, i) => i === index ? { ...ing, [field]: value } : ing))
  }

  const addIngredient = () => {
    setIngredients(prev => [...prev, { id: generateId(), name: '', quantity: 1, unit: '' }])
  }

  const removeIngredient = (index: number) => {
    setIngredients(prev => prev.filter((_, i) => i !== index))
  }

  const updateStep = (index: number, value: string) => {
    setSteps(prev => prev.map((step, i) => i === index ? value : step))
  }

  const addStep = () => {
    setSteps(prev => [...prev, ''])
  }

  const removeStep = (index: number) => {
    setSteps(prev => prev.filter((_, i) => i !== index))
  }

  const validate = () => {
    const newErrors: typeof errors = {}
    if (!name.trim()) newErrors.name = 'Name is required'
    const ingErrors = ingredients.map(ing => ing.name.trim() === '' ? 'Ingredient name is required' : '')
    if (ingErrors.some(e => e !== '')) newErrors.ingredientNames = ingErrors
    const stepErrors = steps.map(step => step.trim() === '' ? 'Step cannot be empty' : '')
    if (stepErrors.some(e => e !== '')) newErrors.stepTexts = stepErrors
    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }

  const handleSubmit = () => {
    if (!validate()) return
    const ratio = initialRecipe ? initialRecipe.currentServings / initialRecipe.baseServings : 1
    const newCurrentServings = Math.max(1, Math.round(baseServings * ratio))
    const recipe: Recipe = {
      id: initialRecipe ? initialRecipe.id : generateId(),
      name: name.trim(),
      ingredients: ingredients.map(ing => ({ ...ing, name: ing.name.trim(), quantity: Number(ing.quantity) || 1, unit: ing.unit.trim() })),
      steps: steps.map(s => s.trim()),
      baseServings: Number(baseServings) || 1,
      currentServings: newCurrentServings,
      favourite: initialRecipe?.favourite ?? false,
      blockColor: initialRecipe?.blockColor || '',
    }
    onSave(recipe)
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{initialRecipe ? 'Edit recipe' : 'Add recipe'}</DialogTitle>
        </DialogHeader>
        <form onSubmit={(e) => { e.preventDefault(); handleSubmit(); }} className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="recipe-name">Recipe name</Label>
            <Input id="recipe-name" value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Spicy peanut noodles" />
            {errors.name && <p className="text-sm text-destructive">{errors.name}</p>}
          </div>

          <div className="grid gap-2">
            <Label htmlFor="servings">Base servings</Label>
            <Input id="servings" type="number" min="1" value={baseServings} onChange={e => setBaseServings(Number(e.target.value))} />
          </div>

          <fieldset className="grid gap-2 border-2 border-border p-4">
            <legend className="text-sm font-semibold px-1">Ingredients</legend>
            <div className="grid grid-cols-[1fr_80px_80px_auto] gap-2 items-end">
              <Label>Name</Label>
              <Label>Amount</Label>
              <Label>Unit</Label>
              <span></span>
            </div>
            {ingredients.map((ing, index) => (
              <div key={ing.id} className="grid grid-cols-[1fr_80px_80px_auto] gap-2 items-end">
                <Input value={ing.name} onChange={e => updateIngredient(index, 'name', e.target.value)} placeholder="Ingredient" aria-label={`Ingredient ${index+1} name`} />
                <Input type="number" min="0" step="any" value={ing.quantity} onChange={e => updateIngredient(index, 'quantity', Number(e.target.value))} aria-label={`Ingredient ${index+1} amount`} />
                <Input value={ing.unit} onChange={e => updateIngredient(index, 'unit', e.target.value)} placeholder="g" aria-label={`Ingredient ${index+1} unit`} />
                <Button type="button" variant="ghost" size="icon" onClick={() => removeIngredient(index)} aria-label={`Remove ingredient ${index+1}`} className="h-11 w-11 border-2 border-border">
                  <X className="h-4 w-4" />
                </Button>
              </div>
            ))}
            {errors.ingredientNames && errors.ingredientNames.map((err, i) => err ? <p key={i} className="text-sm text-destructive">{err}</p> : null)}
            <Button type="button" variant="outline" onClick={addIngredient} className="justify-self-start">
              <Plus className="h-4 w-4 mr-1" /> Add ingredient
            </Button>
          </fieldset>

          <fieldset className="grid gap-3 border-2 border-border p-4">
            <legend className="text-sm font-semibold px-1">Steps</legend>
            {steps.map((step, index) => (
              <div key={index} className="grid gap-2">
                <Label>Step {index + 1}</Label>
                <div className="flex gap-2 items-start">
                  <Textarea value={step} onChange={e => updateStep(index, e.target.value)} placeholder={`Describe step ${index+1}`} />
                  <Button type="button" variant="ghost" size="icon" onClick={() => removeStep(index)} aria-label={`Remove step ${index+1}`} className="h-11 w-11 border-2 border-border mt-0">
                    <X className="h-4 w-4" />
                  </Button>
                </div>
                {errors.stepTexts && errors.stepTexts[index] && <p className="text-sm text-destructive">{errors.stepTexts[index]}</p>}
              </div>
            ))}
            <Button type="button" variant="outline" onClick={addStep} className="justify-self-start">
              <Plus className="h-4 w-4 mr-1" /> Add step
            </Button>
          </fieldset>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit">{initialRecipe ? 'Save changes' : 'Add recipe'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
