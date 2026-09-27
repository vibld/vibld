import { motion } from 'motion/react'
import { Minus, Plus, Star, Trash2, Pencil } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { Recipe } from '@/types'

type Props = {
  recipe: Recipe;
  onUpdateServings: (id: string, newServings: number) => void;
  onToggleFavourite: (id: string) => void;
  onDelete: (id: string) => void;
  onEdit: (recipe: Recipe) => void;
}

const formatQuantity = (q: number) => {
  if (Number.isInteger(q)) return q.toString()
  return parseFloat(q.toFixed(2)).toString()
}

export default function RecipeCard({ recipe, onUpdateServings, onToggleFavourite, onDelete, onEdit }: Props) {
  const colorMap: Record<string, { bg: string; text: string }> = {
    'block-orange': { bg: 'bg-block-orange', text: 'text-primary-foreground' },
    'block-blue': { bg: 'bg-block-blue', text: 'text-primary-foreground' },
    'block-yellow': { bg: 'bg-block-yellow', text: 'text-foreground' },
    'block-green': { bg: 'bg-block-green', text: 'text-primary-foreground' },
    'block-pink': { bg: 'bg-block-pink', text: 'text-primary-foreground' },
    'block-purple': { bg: 'bg-block-purple', text: 'text-primary-foreground' },
    'block-teal': { bg: 'bg-block-teal', text: 'text-primary-foreground' },
  }
  const { bg, text } = colorMap[recipe.blockColor] || { bg: 'bg-primary', text: 'text-primary-foreground' }

  const scale = recipe.currentServings / recipe.baseServings

  return (
    <motion.li
      layout
      initial={{ opacity: 0, y: 48 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.95 }}
      transition={{ type: 'spring', stiffness: 300, damping: 25 }}
      whileHover={{ scale: 1.02 }}
      whileTap={{ scale: 0.98 }}
      className={cn('border-2 border-border p-4 flex flex-col gap-4', bg, text)}
    >
      <div className="flex items-start justify-between gap-2">
        <h3 className="text-title font-bold leading-tight">{recipe.name}</h3>
        <div className="flex gap-1">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => onToggleFavourite(recipe.id)}
            aria-label={recipe.favourite ? 'Remove from favourites' : 'Add to favourites'}
            className={cn('h-11 w-11 border-2 border-current', recipe.favourite ? 'text-accent' : 'text-current')}
          >
            <Star className={cn('h-5 w-5', recipe.favourite && 'fill-current')} />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => onEdit(recipe)}
            aria-label="Edit recipe"
            className="h-11 w-11 border-2 border-current"
          >
            <Pencil className="h-5 w-5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => onDelete(recipe.id)}
            aria-label="Delete recipe"
            className="h-11 w-11 border-2 border-current"
          >
            <Trash2 className="h-5 w-5" />
          </Button>
        </div>
      </div>

      <div className="flex items-center gap-3 border-2 border-current p-2">
        <span className="text-sm font-semibold">Servings</span>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="icon"
            onClick={() => onUpdateServings(recipe.id, recipe.currentServings - 1)}
            aria-label="Decrease servings"
            className="h-8 w-8 border-2 border-current bg-transparent"
          >
            <Minus className="h-4 w-4" />
          </Button>
          <span className="text-lg font-bold w-8 text-center">{recipe.currentServings}</span>
          <Button
            variant="outline"
            size="icon"
            onClick={() => onUpdateServings(recipe.id, recipe.currentServings + 1)}
            aria-label="Increase servings"
            className="h-8 w-8 border-2 border-current bg-transparent"
          >
            <Plus className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div className="space-y-2">
        <h4 className="text-lg font-bold">Ingredients</h4>
        <ul className="space-y-1">
          {recipe.ingredients.map(ing => {
            const scaledQty = ing.quantity * scale
            return (
              <li key={ing.id} className="text-sm">
                {formatQuantity(scaledQty)} {ing.unit} {ing.name}
              </li>
            )
          })}
        </ul>
      </div>

      <div className="space-y-2">
        <h4 className="text-lg font-bold">Steps</h4>
        <ol className="space-y-1 list-decimal list-inside">
          {recipe.steps.map((step, index) => (
            <li key={index} className="text-sm">{step}</li>
          ))}
        </ol>
      </div>
    </motion.li>
  )
}
